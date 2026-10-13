import type { SupabaseClient } from "@supabase/supabase-js";
import { type Baseline, EMPTY_SNAPSHOT, type SyncActivity, type SyncSnapshot, type TimeEntry } from "./merge";
import { type PullCursor, type PullCursors, sanitizeBaseline, sanitizeEntry, sanitizeSyncActivity } from "./state";

export type SyncErrorKind = "offline" | "auth" | "not-set-up" | "server";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** The engine's view of the server, so merge and retry logic can be tested without a network. */
export interface SyncRemote {
  push(userId: string, changes: SyncSnapshot): Promise<void>;
  pull(userId: string, cursors: PullCursors): Promise<{ snapshot: SyncSnapshot; cursors: PullCursors }>;
}

export const TABLES = {
  activities: "tapact_activities",
  entries: "tapact_time_entries",
  baselines: "tapact_daily_baselines",
} as const;

const PUSH_CHUNK = 250;
const PULL_PAGE = 500;
/** Re-read a window before the cursor so rows committed late with an earlier timestamp aren't missed. */
const PULL_OVERLAP_MS = 5 * 60_000;

type PostgrestErrorLike = { code?: string; message?: string; status?: number } | null;

export function classifyRemoteError(error: PostgrestErrorLike | unknown): SyncError {
  const candidate = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    name?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (code === "PGRST205" || code === "42P01" || message.includes("could not find the table")) {
    return new SyncError("not-set-up", "Cloud storage for TapAct isn't set up yet.");
  }
  if (code === "PGRST204" || code === "42703") {
    return new SyncError("not-set-up", "Cloud storage needs the latest TapAct update before session edits can sync.");
  }
  if (code === "PGRST301" || code === "PGRST303" || code === "42501" || candidate.status === 401 || message.includes("jwt")) {
    return new SyncError("auth", "Your session needs to be refreshed. Sign in again to continue syncing.");
  }
  if (
    candidate.name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("fetch failed")
  ) {
    return new SyncError("offline", "Can't reach the sync server.");
  }
  return new SyncError("server", "The sync server couldn't process the request.");
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function activityToRow(userId: string, activity: SyncActivity) {
  return {
    user_id: userId,
    id: activity.id,
    name: activity.name,
    icon_key: activity.iconKey,
    color: activity.color,
    goal_minutes: activity.goalMinutes,
    cue: activity.cue,
    archived_at_ms: activity.archivedAtMs,
    client_updated_at_ms: Math.round(activity.updatedAtMs),
    updated_by_device: activity.deviceId,
  };
}

/** Manual or deleted sessions need the session-edit columns; plain timer segments don't. */
export function isEditedEntry(entry: TimeEntry): boolean {
  return entry.source === "manual" || entry.deletedAtMs !== undefined;
}

export function entryToRow(userId: string, entry: TimeEntry) {
  const row = {
    user_id: userId,
    id: entry.id,
    activity_id: entry.activityId,
    device_id: entry.deviceId,
    started_at_ms: Math.round(entry.startMs),
    ended_at_ms: Math.round(entry.endMs),
  };
  if (!isEditedEntry(entry)) {
    return row;
  }
  return {
    ...row,
    source: entry.source ?? "timer",
    deleted_at_ms: entry.deletedAtMs === undefined ? null : Math.round(entry.deletedAtMs),
  };
}

export function baselineToRow(userId: string, baseline: Baseline) {
  return {
    user_id: userId,
    id: baseline.id,
    source_id: baseline.sourceId,
    day_key: baseline.dayKey,
    activity_id: baseline.activityId,
    elapsed_ms: Math.round(baseline.ms),
  };
}

export function rowToActivity(row: Record<string, unknown>): SyncActivity | null {
  return sanitizeSyncActivity({
    id: row.id,
    name: row.name,
    iconKey: row.icon_key,
    color: row.color,
    goalMinutes: row.goal_minutes,
    cue: row.cue,
    archivedAtMs: row.archived_at_ms,
    updatedAtMs: row.client_updated_at_ms,
    deviceId: row.updated_by_device,
  });
}

export function rowToEntry(row: Record<string, unknown>): TimeEntry | null {
  return sanitizeEntry({
    id: row.id,
    activityId: row.activity_id,
    deviceId: row.device_id,
    startMs: row.started_at_ms,
    endMs: row.ended_at_ms,
    source: row.source,
    deletedAtMs: row.deleted_at_ms,
  });
}

export function rowToBaseline(row: Record<string, unknown>): Baseline | null {
  return sanitizeBaseline({
    id: row.id,
    sourceId: row.source_id,
    dayKey: row.day_key,
    activityId: row.activity_id,
    ms: row.elapsed_ms,
  });
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  async function upsert(table: string, rows: Record<string, unknown>[]) {
    for (const chunk of chunks(rows, PUSH_CHUNK)) {
      let result;
      try {
        result = await client.from(table).upsert(chunk, { onConflict: "user_id,id" });
      } catch (error) {
        throw classifyRemoteError(error);
      }
      if (result.error) {
        throw classifyRemoteError({ ...result.error, status: result.status });
      }
    }
  }

  async function pullTable<T>(
    table: string,
    userId: string,
    cursor: PullCursor,
    map: (row: Record<string, unknown>) => T | null,
  ): Promise<{ items: T[]; cursor: PullCursor }> {
    const items: T[] = [];
    let last: PullCursor = null;
    const since = cursor ? new Date(Date.parse(cursor.updatedAt) - PULL_OVERLAP_MS).toISOString() : null;
    let next = cursor;
    for (;;) {
      let query = client.from(table).select("*").eq("user_id", userId);
      if (last) {
        query = query.or(`updated_at.gt.${quote(last.updatedAt)},and(updated_at.eq.${quote(last.updatedAt)},id.gt.${quote(last.id)})`);
      } else if (since) {
        query = query.gt("updated_at", since);
      }
      let result;
      try {
        result = await query.order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(PULL_PAGE);
      } catch (error) {
        throw classifyRemoteError(error);
      }
      if (result.error) {
        throw classifyRemoteError({ ...result.error, status: result.status });
      }
      const rows = (result.data ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const item = map(row);
        if (item) items.push(item);
      }
      const tail = rows[rows.length - 1];
      if (tail && typeof tail.updated_at === "string" && typeof tail.id === "string") {
        last = { updatedAt: tail.updated_at, id: tail.id };
        if (!next || Date.parse(last.updatedAt) >= Date.parse(next.updatedAt)) {
          next = last;
        }
      }
      if (rows.length < PULL_PAGE) {
        break;
      }
    }
    return { items, cursor: next };
  }

  return {
    async push(userId, changes) {
      // Activities first: entries and baselines reference them.
      await upsert(TABLES.activities, changes.activities.map((item) => activityToRow(userId, item)));
      await upsert(TABLES.baselines, changes.baselines.map((item) => baselineToRow(userId, item)));
      // Separate requests keep row shapes uniform, so plain segments never send the edit columns.
      await upsert(TABLES.entries, changes.entries.filter((item) => !isEditedEntry(item)).map((item) => entryToRow(userId, item)));
      await upsert(TABLES.entries, changes.entries.filter(isEditedEntry).map((item) => entryToRow(userId, item)));
    },
    async pull(userId, cursors) {
      const activities = await pullTable(TABLES.activities, userId, cursors.activities, rowToActivity);
      const baselines = await pullTable(TABLES.baselines, userId, cursors.baselines, rowToBaseline);
      const entries = await pullTable(TABLES.entries, userId, cursors.entries, rowToEntry);
      return {
        snapshot: { ...EMPTY_SNAPSHOT, activities: activities.items, baselines: baselines.items, entries: entries.items },
        cursors: { activities: activities.cursor, baselines: baselines.cursor, entries: entries.cursor },
      };
    },
  };
}
