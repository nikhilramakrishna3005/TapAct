import {
  type Activity,
  type ActivityIconName,
  type DailyRecords,
  processActiveTimer,
  splitAcrossDays,
  type TrackerState,
} from "../tracker";

/** An activity as stored in the cloud, with the metadata needed for last-writer-wins. */
export type SyncActivity = {
  id: string;
  name: string;
  iconKey: ActivityIconName;
  color: string;
  goalMinutes: number | null;
  cue: string;
  archivedAtMs: number | null;
  updatedAtMs: number;
  deviceId: string;
};

/**
 * A session recorded on one device. Its identity is immutable and its end only ever
 * grows; corrections are a tombstone on the original plus a new "manual" entry.
 */
export type TimeEntry = {
  id: string;
  activityId: string;
  deviceId: string;
  startMs: number;
  endMs: number;
  /** Absent for timer segments. */
  source?: "manual";
  /** Set once the session was deleted or replaced by an edit; never cleared. */
  deletedAtMs?: number;
};

export function isLiveEntry(entry: TimeEntry): boolean {
  return entry.deletedAtMs === undefined;
}

/** A per-day total imported from pre-sync history (no interval detail available). */
export type Baseline = {
  id: string;
  sourceId: string;
  dayKey: string;
  activityId: string;
  ms: number;
};

export type SyncSnapshot = {
  activities: SyncActivity[];
  entries: TimeEntry[];
  baselines: Baseline[];
};

/** Matches the database check: a local day is at most 25 hours (DST fall-back). */
export const MAX_BASELINE_MS = 90_000_000;

export const EMPTY_SNAPSHOT: SyncSnapshot = { activities: [], entries: [], baselines: [] };

export function entryId(deviceId: string, activityId: string, startMs: number): string {
  return `${deviceId}:${activityId}:${startMs}`;
}

export function baselineId(sourceId: string, dayKey: string, activityId: string): string {
  return `${sourceId}|${dayKey}|${activityId}`;
}

export function toSyncActivity(activity: Activity, updatedAtMs: number, deviceId: string): SyncActivity {
  return { ...activity, updatedAtMs, deviceId };
}

export function toActivity(activity: SyncActivity): Activity {
  return {
    id: activity.id,
    name: activity.name,
    iconKey: activity.iconKey,
    color: activity.color,
    goalMinutes: activity.goalMinutes,
    cue: activity.cue,
    archivedAtMs: activity.archivedAtMs,
  };
}

export function sameActivityFields(a: Activity, b: Activity): boolean {
  return (
    a.name === b.name &&
    a.iconKey === b.iconKey &&
    a.color === b.color &&
    a.goalMinutes === b.goalMinutes &&
    a.cue === b.cue &&
    a.archivedAtMs === b.archivedAtMs
  );
}

function isNewer(a: SyncActivity, b: SyncActivity): boolean {
  if (a.updatedAtMs !== b.updatedAtMs) {
    return a.updatedAtMs > b.updatedAtMs;
  }
  return a.deviceId > b.deviceId;
}

function earliestArchive(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Deterministic, order-independent activity merge (mirrors the server trigger):
 * the newest edit wins field-by-field as a whole, and archiving is sticky.
 */
export function mergeActivity(a: SyncActivity, b: SyncActivity): SyncActivity {
  const winner = isNewer(b, a) ? b : a;
  return { ...winner, archivedAtMs: earliestArchive(a.archivedAtMs, b.archivedAtMs) };
}

export function mergeActivityLists(...lists: SyncActivity[][]): SyncActivity[] {
  const byId = new Map<string, SyncActivity>();
  for (const list of lists) {
    for (const activity of list) {
      const existing = byId.get(activity.id);
      byId.set(activity.id, existing ? mergeActivity(existing, activity) : activity);
    }
  }
  return [...byId.values()];
}

/**
 * Same entry from several sources (retries, both devices): keep the longest end, and a
 * deletion from any source wins (earliest time), so a stale copy can't restore it.
 */
export function mergeEntryLists(...lists: TimeEntry[][]): TimeEntry[] {
  const byId = new Map<string, TimeEntry>();
  for (const list of lists) {
    for (const entry of list) {
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, entry);
        continue;
      }
      const deletedAtMs = earliestArchive(existing.deletedAtMs ?? null, entry.deletedAtMs ?? null);
      if (entry.endMs > existing.endMs || deletedAtMs !== (existing.deletedAtMs ?? null)) {
        const merged: TimeEntry = { ...existing, endMs: Math.max(existing.endMs, entry.endMs) };
        if (deletedAtMs !== null) merged.deletedAtMs = deletedAtMs;
        byId.set(entry.id, merged);
      }
    }
  }
  return [...byId.values()];
}

export function mergeBaselineLists(...lists: Baseline[][]): Baseline[] {
  const byId = new Map<string, Baseline>();
  for (const list of lists) {
    for (const baseline of list) {
      if (!byId.has(baseline.id)) {
        byId.set(baseline.id, baseline);
      }
    }
  }
  return [...byId.values()];
}

export function mergeSnapshots(...snapshots: SyncSnapshot[]): SyncSnapshot {
  return {
    activities: mergeActivityLists(...snapshots.map((snapshot) => snapshot.activities)),
    entries: mergeEntryLists(...snapshots.map((snapshot) => snapshot.entries)),
    baselines: mergeBaselineLists(...snapshots.map((snapshot) => snapshot.baselines)),
  };
}

/** Union of possibly-overlapping intervals, so overlapping time is counted once. */
export function unionIntervals(intervals: { startMs: number; endMs: number }[]): { startMs: number; endMs: number }[] {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .map((interval) => ({ ...interval }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * Builds per-day totals from synced records:
 * - Baselines (imported pre-sync totals) are summed per day/activity across sources,
 *   except identical totals, which are the same history imported twice (for example a
 *   restored backup on a second device) and are counted once.
 * - Timer segments are unioned per activity, so overlapping time from two devices,
 *   or the same segment uploaded twice, is never counted twice. Deleted ones don't count.
 */
export function computeDailyRecords(snapshot: Pick<SyncSnapshot, "entries" | "baselines">): DailyRecords {
  const records: DailyRecords = {};
  const add = (dayKey: string, activityId: string, ms: number) => {
    if (ms <= 0) return;
    const day = records[dayKey] ?? (records[dayKey] = {});
    day[activityId] = (day[activityId] ?? 0) + ms;
  };

  const baselineValues = new Map<string, Set<number>>();
  for (const baseline of snapshot.baselines) {
    const key = `${baseline.dayKey}|${baseline.activityId}`;
    const values = baselineValues.get(key) ?? new Set<number>();
    values.add(baseline.ms);
    baselineValues.set(key, values);
  }
  for (const [key, values] of baselineValues) {
    const [dayKey, activityId] = key.split("|");
    for (const ms of values) {
      add(dayKey, activityId, ms);
    }
  }

  const byActivity = new Map<string, TimeEntry[]>();
  for (const entry of snapshot.entries) {
    if (!isLiveEntry(entry)) continue;
    const list = byActivity.get(entry.activityId) ?? [];
    list.push(entry);
    byActivity.set(entry.activityId, list);
  }
  for (const [activityId, entries] of byActivity) {
    for (const interval of unionIntervals(entries)) {
      for (const span of splitAcrossDays(interval.startMs, interval.endMs)) {
        add(span.dayKey, activityId, span.durationMs);
      }
    }
  }
  return records;
}

export type SessionFloor = { activityId: string; sinceMs: number; floorMs: number } | null;

/**
 * The timer segment the tracker has credited for its running session, or null.
 * `floor` marks time already counted elsewhere (an import taken mid-session).
 */
export function runningSegment(state: TrackerState, deviceId: string, floor: SessionFloor): TimeEntry | null {
  if (!state.activeActivityId || state.activeSinceMs === null || state.lastProcessedMs === null) {
    return null;
  }
  const floored =
    floor && floor.activityId === state.activeActivityId && floor.sinceMs === state.activeSinceMs
      ? Math.max(state.activeSinceMs, floor.floorMs)
      : state.activeSinceMs;
  if (state.lastProcessedMs <= floored) {
    return null;
  }
  return {
    id: entryId(deviceId, state.activeActivityId, floored),
    activityId: state.activeActivityId,
    deviceId,
    startMs: floored,
    endMs: state.lastProcessedMs,
  };
}

/**
 * Projects the merged synced view onto the local tracker. Local activities that the
 * snapshot doesn't know yet are kept (never dropped); the running timer keeps going
 * unless the merged view archived its activity.
 */
export function applySnapshot(
  base: TrackerState,
  snapshot: SyncSnapshot,
  nowMs: number,
  deviceId: string,
  floor: SessionFloor,
): TrackerState {
  const settled = processActiveTimer(base, nowMs);
  const running = runningSegment(settled, deviceId, floor);
  const entries = running ? mergeEntryLists(snapshot.entries, [running]) : snapshot.entries;

  const merged = new Map(snapshot.activities.map((activity) => [activity.id, toActivity(activity)]));
  const activities: Activity[] = settled.activities.map((activity) => merged.get(activity.id) ?? activity);
  const known = new Set(activities.map((activity) => activity.id));
  const added = [...merged.values()].filter((activity) => !known.has(activity.id)).sort((a, b) => a.id.localeCompare(b.id));
  activities.push(...added);

  const activeStillValid =
    settled.activeActivityId !== null &&
    activities.some((activity) => activity.id === settled.activeActivityId && activity.archivedAtMs === null);

  const validIds = new Set(activities.map((activity) => activity.id));
  const dailyRecords: DailyRecords = {};
  for (const [dayKey, day] of Object.entries(computeDailyRecords({ entries, baselines: snapshot.baselines }))) {
    const filtered = Object.fromEntries(Object.entries(day).filter(([id]) => validIds.has(id)));
    if (Object.keys(filtered).length > 0) {
      dailyRecords[dayKey] = filtered;
    }
  }

  return {
    ...settled,
    activities,
    dailyRecords,
    activeActivityId: activeStillValid ? settled.activeActivityId : null,
    activeSinceMs: activeStillValid ? settled.activeSinceMs : null,
    lastProcessedMs: activeStillValid ? settled.lastProcessedMs : null,
  };
}

/** Converts local per-day totals into immutable baseline records for one import. */
export function baselinesFromTracker(state: TrackerState, sourceId: string): Baseline[] {
  const baselines: Baseline[] = [];
  for (const [dayKey, day] of Object.entries(state.dailyRecords)) {
    for (const [activityId, ms] of Object.entries(day)) {
      const rounded = Math.min(Math.round(ms), MAX_BASELINE_MS);
      if (rounded > 0) {
        baselines.push({ id: baselineId(sourceId, dayKey, activityId), sourceId, dayKey, activityId, ms: rounded });
      }
    }
  }
  return baselines;
}
