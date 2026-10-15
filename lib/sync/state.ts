import {
  type Activity,
  type ActivityIconName,
  DEFAULT_ACTIVITIES,
  isLifeCategoryId,
  loadTrackerState,
  STORAGE_KEY_V3,
  type TrackerState,
} from "../tracker";
import type { WritableStorageLike } from "../trackerStore";
import {
  type Baseline,
  EMPTY_SNAPSHOT,
  mergeActivityLists,
  mergeBaselineLists,
  mergeEntryLists,
  sameActivityFields,
  type SessionFloor,
  type SyncActivity,
  type SyncSnapshot,
  type TimeEntry,
} from "./merge";

/**
 * Sync bookkeeping lives beside the tracker (never inside it), so the v3 tracker
 * schema and backups are unchanged.
 */
export const SYNC_META_KEY = "tapact.sync.v1";
export const SYNC_CACHE_KEY = "tapact.sync.cache.v1";
export const SYNC_STASH_KEY = "tapact.sync.stash.v1";

export type SyncOwner = { userId: string; email: string | null };

/** Local changes not yet confirmed by the server, kept per account. */
export type Outbox = SyncSnapshot & { userId: string };

export type SyncMeta = {
  version: 1;
  deviceId: string;
  /** Account the local tracker data belongs to; null for guest data that was never synced. */
  owner: SyncOwner | null;
  floor: SessionFloor;
  outboxes: Outbox[];
  lastSyncedAtMs: number | null;
  lastSyncedUserId: string | null;
  /** Accounts whose local data must not be uploaded again after deletion. */
  blockedUserIds?: string[];
};

export type PullCursor = { updatedAt: string; id: string } | null;
export type PullCursors = { activities: PullCursor; entries: PullCursor; baselines: PullCursor };
export const EMPTY_CURSORS: PullCursors = { activities: null, entries: null, baselines: null };

/** Server rows already pulled for one account. Rebuildable at any time with a full pull. */
export type SyncCache = { userId: string; cursors: PullCursors; snapshot: SyncSnapshot };

/** Tracker data set aside on this device when it switched owners. Never deleted automatically. */
export type StashEntry = {
  id: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  stashedAtMs: number;
  mergedIntoUserId: string | null;
  tracker: TrackerState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(storage: WritableStorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: WritableStorageLike | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function createDeviceId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

export function sanitizeSyncActivity(value: unknown): SyncActivity | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 120);
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 36) : "";
  if (!id || !name) return null;
  const color = typeof value.color === "string" && /^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : "#B6BFCB";
  const goal = isFiniteNumber(value.goalMinutes) && value.goalMinutes >= 1 && value.goalMinutes <= 1440 ? Math.round(value.goalMinutes) : null;
  return {
    id,
    name,
    iconKey: (str(value.iconKey, 32) ?? "briefcase") as ActivityIconName,
    color,
    goalMinutes: goal,
    cue: typeof value.cue === "string" ? value.cue.slice(0, 48) : "",
    archivedAtMs: isFiniteNumber(value.archivedAtMs) && value.archivedAtMs >= 0 ? value.archivedAtMs : null,
    category: value.category === undefined ? undefined : isLifeCategoryId(value.category) ? value.category : null,
    updatedAtMs: isFiniteNumber(value.updatedAtMs) && value.updatedAtMs >= 0 ? value.updatedAtMs : 0,
    deviceId: typeof value.deviceId === "string" ? value.deviceId.slice(0, 64) : "",
  };
}

export function sanitizeEntry(value: unknown): TimeEntry | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 240);
  const activityId = str(value.activityId, 120);
  const deviceId = str(value.deviceId, 64);
  if (!id || !activityId || !deviceId) return null;
  if (!isFiniteNumber(value.startMs) || !isFiniteNumber(value.endMs) || value.startMs <= 0 || value.endMs < value.startMs) {
    return null;
  }
  const entry: TimeEntry = { id, activityId, deviceId, startMs: value.startMs, endMs: value.endMs };
  if (value.source === "manual") entry.source = "manual";
  if (isFiniteNumber(value.deletedAtMs) && value.deletedAtMs >= 0) entry.deletedAtMs = value.deletedAtMs;
  return entry;
}

export function sanitizeBaseline(value: unknown): Baseline | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 320);
  const sourceId = str(value.sourceId, 160);
  const activityId = str(value.activityId, 120);
  const dayKey = typeof value.dayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.dayKey) ? value.dayKey : null;
  if (!id || !sourceId || !activityId || !dayKey || !isFiniteNumber(value.ms) || value.ms < 0) return null;
  return { id, sourceId, dayKey, activityId, ms: value.ms };
}

function sanitizeList<T>(value: unknown, sanitize: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(sanitize).filter((item): item is T => item !== null) : [];
}

export function sanitizeSnapshot(value: unknown): SyncSnapshot {
  if (!isRecord(value)) return { ...EMPTY_SNAPSHOT };
  return {
    activities: sanitizeList(value.activities, sanitizeSyncActivity),
    entries: sanitizeList(value.entries, sanitizeEntry),
    baselines: sanitizeList(value.baselines, sanitizeBaseline),
  };
}

function sanitizeBlocked(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 64);
  return [...new Set(ids)].slice(0, 20);
}

export function isAccountBlocked(meta: SyncMeta, userId: string): boolean {
  return (meta.blockedUserIds ?? []).includes(userId);
}

function sanitizeOwner(value: unknown): SyncOwner | null {
  if (!isRecord(value)) return null;
  const userId = str(value.userId, 64);
  if (!userId) return null;
  return { userId, email: typeof value.email === "string" ? value.email.slice(0, 254) : null };
}

function sanitizeFloor(value: unknown): SessionFloor {
  if (!isRecord(value)) return null;
  const activityId = str(value.activityId, 120);
  if (!activityId || !isFiniteNumber(value.sinceMs) || !isFiniteNumber(value.floorMs)) return null;
  return { activityId, sinceMs: value.sinceMs, floorMs: value.floorMs };
}

export function loadSyncMeta(storage: WritableStorageLike | null): SyncMeta {
  const raw = readJson(storage, SYNC_META_KEY);
  const candidate = isRecord(raw) && raw.version === 1 ? raw : null;
  const deviceId = candidate ? str(candidate.deviceId, 64) : null;
  const meta: SyncMeta = {
    version: 1,
    deviceId: deviceId ?? createDeviceId(),
    owner: candidate ? sanitizeOwner(candidate.owner) : null,
    floor: candidate ? sanitizeFloor(candidate.floor) : null,
    outboxes: candidate
      ? sanitizeList(candidate.outboxes, (item) => {
          if (!isRecord(item)) return null;
          const userId = str(item.userId, 64);
          return userId ? { userId, ...sanitizeSnapshot(item) } : null;
        })
      : [],
    lastSyncedAtMs: candidate && isFiniteNumber(candidate.lastSyncedAtMs) ? candidate.lastSyncedAtMs : null,
    lastSyncedUserId: candidate ? str(candidate.lastSyncedUserId, 64) : null,
    blockedUserIds: candidate ? sanitizeBlocked(candidate.blockedUserIds) : [],
  };
  if (!deviceId) {
    writeJson(storage, SYNC_META_KEY, meta);
  }
  return meta;
}

export function saveSyncMeta(storage: WritableStorageLike | null, meta: SyncMeta): boolean {
  return writeJson(storage, SYNC_META_KEY, meta);
}

export function getOutbox(meta: SyncMeta, userId: string): Outbox {
  return meta.outboxes.find((outbox) => outbox.userId === userId) ?? { userId, ...EMPTY_SNAPSHOT };
}

export function outboxSize(outbox: SyncSnapshot): number {
  return outbox.activities.length + outbox.entries.length + outbox.baselines.length;
}

export function addToOutbox(meta: SyncMeta, userId: string, additions: Partial<SyncSnapshot>): SyncMeta {
  const current = getOutbox(meta, userId);
  const next: Outbox = {
    userId,
    activities: mergeActivityLists(current.activities, additions.activities ?? []),
    entries: mergeEntryLists(current.entries, additions.entries ?? []),
    baselines: mergeBaselineLists(current.baselines, additions.baselines ?? []),
  };
  return { ...meta, outboxes: [...meta.outboxes.filter((outbox) => outbox.userId !== userId), next] };
}

/**
 * Drops outbox items the server confirmed, but only if they weren't changed again
 * while the upload was in flight (a running timer keeps extending its segment).
 */
export function removeConfirmed(meta: SyncMeta, userId: string, confirmed: SyncSnapshot): SyncMeta {
  const current = getOutbox(meta, userId);
  const sentActivities = new Map(confirmed.activities.map((item) => [item.id, item]));
  const sentEntries = new Map(confirmed.entries.map((item) => [item.id, item]));
  const sentBaselines = new Set(confirmed.baselines.map((item) => item.id));
  const next: Outbox = {
    userId,
    activities: current.activities.filter((item) => {
      const sent = sentActivities.get(item.id);
      return !(sent && sent.updatedAtMs === item.updatedAtMs && sent.deviceId === item.deviceId && sameActivityFields(sent, item));
    }),
    entries: current.entries.filter((item) => {
      const sent = sentEntries.get(item.id);
      return !(sent && sent.endMs >= item.endMs && (item.deletedAtMs === undefined || sent.deletedAtMs !== undefined));
    }),
    baselines: current.baselines.filter((item) => !sentBaselines.has(item.id)),
  };
  const others = meta.outboxes.filter((outbox) => outbox.userId !== userId);
  return { ...meta, outboxes: outboxSize(next) > 0 ? [...others, next] : others };
}

export function loadSyncCache(storage: WritableStorageLike | null, userId: string): SyncCache {
  const raw = readJson(storage, SYNC_CACHE_KEY);
  if (isRecord(raw) && raw.userId === userId && isRecord(raw.cursors)) {
    const cursor = (value: unknown): PullCursor =>
      isRecord(value) && typeof value.updatedAt === "string" && typeof value.id === "string"
        ? { updatedAt: value.updatedAt, id: value.id }
        : null;
    return {
      userId,
      cursors: {
        activities: cursor(raw.cursors.activities),
        entries: cursor(raw.cursors.entries),
        baselines: cursor(raw.cursors.baselines),
      },
      snapshot: sanitizeSnapshot(raw.snapshot),
    };
  }
  return { userId, cursors: { ...EMPTY_CURSORS }, snapshot: { ...EMPTY_SNAPSHOT } };
}

export function saveSyncCache(storage: WritableStorageLike | null, cache: SyncCache): boolean {
  return writeJson(storage, SYNC_CACHE_KEY, cache);
}

function sanitizeTracker(value: unknown, nowMs: number): TrackerState | null {
  if (!isRecord(value) || value.schemaVersion !== 3) return null;
  const serialized = JSON.stringify(value);
  return loadTrackerState({ getItem: (key) => (key === STORAGE_KEY_V3 ? serialized : null) }, nowMs);
}

export function loadStash(storage: WritableStorageLike | null, nowMs: number): StashEntry[] {
  const raw = readJson(storage, SYNC_STASH_KEY);
  return sanitizeList(raw, (item) => {
    if (!isRecord(item)) return null;
    const id = str(item.id, 80);
    const tracker = sanitizeTracker(item.tracker, nowMs);
    if (!id || !tracker) return null;
    return {
      id,
      ownerUserId: str(item.ownerUserId, 64),
      ownerEmail: typeof item.ownerEmail === "string" ? item.ownerEmail.slice(0, 254) : null,
      stashedAtMs: isFiniteNumber(item.stashedAtMs) ? item.stashedAtMs : 0,
      mergedIntoUserId: str(item.mergedIntoUserId, 64),
      tracker,
    };
  });
}

export function saveStash(storage: WritableStorageLike | null, stash: StashEntry[]): boolean {
  return writeJson(storage, SYNC_STASH_KEY, stash);
}

/** Fresh-install data: default activities, nothing tracked. Safe to replace with account data. */
export function isPristineTracker(state: TrackerState): boolean {
  if (state.activeActivityId !== null || Object.keys(state.dailyRecords).length > 0) {
    return false;
  }
  if (state.activities.length !== DEFAULT_ACTIVITIES.length) {
    return false;
  }
  return state.activities.every((activity: Activity, index) => sameActivityFields(activity, DEFAULT_ACTIVITIES[index]));
}

export type OwnershipDecision =
  | { kind: "in-sync" }
  | { kind: "adopt-pristine" }
  | { kind: "guest-data" }
  | { kind: "other-account"; ownerEmail: string | null };

/**
 * What to do when `userId` is signed in on this device. Guest data is never claimed
 * automatically, and another account's data is never merged into this one.
 */
export function decideOwnership(meta: SyncMeta, tracker: TrackerState, userId: string): OwnershipDecision {
  if (meta.owner?.userId === userId) {
    return { kind: "in-sync" };
  }
  if (meta.owner) {
    return { kind: "other-account", ownerEmail: meta.owner.email };
  }
  return isPristineTracker(tracker) ? { kind: "adopt-pristine" } : { kind: "guest-data" };
}
