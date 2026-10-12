import { createDefaultTrackerState, DEFAULT_ACTIVITIES, processActiveTimer, type TrackerState } from "../tracker";
import type { TrackerUpdate, WritableStorageLike } from "../trackerStore";
import {
  applySnapshot,
  baselinesFromTracker,
  mergeSnapshots,
  type SyncSnapshot,
  toSyncActivity,
} from "./merge";
import { SyncError, type SyncRemote } from "./remote";
import {
  addToOutbox,
  getOutbox,
  loadStash,
  loadSyncCache,
  loadSyncMeta,
  outboxSize,
  removeConfirmed,
  saveStash,
  saveSyncCache,
  saveSyncMeta,
  type StashEntry,
  type SyncCache,
  type SyncMeta,
  type SyncOwner,
} from "./state";

/** Commits made by the engine; the app's commit wrapper must not capture them as activity edits. */
export type EngineCommit = (update: TrackerUpdate) => TrackerState;

export type SyncDeps = {
  storage: WritableStorageLike | null;
  remote: SyncRemote;
  commit: EngineCommit;
  now: () => number;
  /** False once the signed-in account changed, so results are never applied across accounts. */
  isCurrent: (userId: string) => boolean;
};

export type SyncRunResult = { kind: "synced"; pending: number; syncedAtMs: number } | { kind: "aborted" } | { kind: "needs-decision" };

function stopTimer(state: TrackerState, nowMs: number): TrackerState {
  const settled = processActiveTimer(state, nowMs);
  return { ...settled, activeActivityId: null, activeSinceMs: null, lastProcessedMs: null };
}

function requireSaved(saved: boolean) {
  if (!saved) {
    throw new SyncError("server", "This device's storage is full or unavailable, so sync can't continue safely.");
  }
}

async function pullIntoCache(deps: SyncDeps, userId: string): Promise<SyncCache | null> {
  const cache = loadSyncCache(deps.storage, userId);
  const pulled = await deps.remote.pull(userId, cache.cursors);
  if (!deps.isCurrent(userId)) {
    return null;
  }
  const next: SyncCache = { userId, cursors: pulled.cursors, snapshot: mergeSnapshots(cache.snapshot, pulled.snapshot) };
  if (!saveSyncCache(deps.storage, next)) {
    // Without a saved cache the cursors can't advance; the next sync does a full pull instead.
    saveSyncCache(deps.storage, { userId, cursors: { activities: null, entries: null, baselines: null }, snapshot: { activities: [], entries: [], baselines: [] } });
  }
  return next;
}

/** Full cycle: settle the timer, upload unconfirmed changes, pull, and rebuild the local view. */
export async function runSync(deps: SyncDeps, account: SyncOwner): Promise<SyncRunResult> {
  const { userId } = account;
  if (loadSyncMeta(deps.storage).owner?.userId !== userId) {
    return { kind: "needs-decision" };
  }

  const settled = deps.commit((base) => base);

  let meta = loadSyncMeta(deps.storage);
  const cache = loadSyncCache(deps.storage, userId);
  const known = new Set([...cache.snapshot.activities, ...getOutbox(meta, userId).activities].map((item) => item.id));
  const unknown = settled.activities.filter((activity) => !known.has(activity.id));
  if (unknown.length > 0) {
    // Lowest priority, so it can only fill a gap and never overrides a cloud edit.
    meta = addToOutbox(meta, userId, { activities: unknown.map((activity) => toSyncActivity(activity, 0, meta.deviceId)) });
    requireSaved(saveSyncMeta(deps.storage, meta));
  }

  const outbox = getOutbox(meta, userId);
  if (outboxSize(outbox) > 0) {
    await deps.remote.push(userId, outbox);
    if (!deps.isCurrent(userId)) return { kind: "aborted" };
    saveSyncMeta(deps.storage, removeConfirmed(loadSyncMeta(deps.storage), userId, outbox));
  }

  const pulled = await pullIntoCache(deps, userId);
  if (!pulled) return { kind: "aborted" };

  meta = loadSyncMeta(deps.storage);
  if (meta.owner?.userId !== userId || !deps.isCurrent(userId)) {
    return { kind: "aborted" };
  }
  const merged = mergeSnapshots(pulled.snapshot, getOutbox(meta, userId));
  deps.commit((base, nowMs) => applySnapshot(base, merged, nowMs, meta.deviceId, meta.floor));

  const syncedAtMs = deps.now();
  meta = { ...loadSyncMeta(deps.storage), lastSyncedAtMs: syncedAtMs, lastSyncedUserId: userId };
  saveSyncMeta(deps.storage, meta);
  return { kind: "synced", pending: outboxSize(getOutbox(meta, userId)), syncedAtMs };
}

/**
 * Brings the guest data currently on this device into `account`. Pre-sync history
 * has only per-day totals, so it is uploaded as one immutable baseline set; a
 * running timer keeps going and only time after this moment is recorded as a new
 * segment, so nothing is counted twice. Existing account activities keep their
 * cloud settings (imported copies have the lowest edit priority).
 */
export async function importLocalData(deps: SyncDeps, account: SyncOwner): Promise<SyncRunResult> {
  const meta = loadSyncMeta(deps.storage);
  if (meta.owner) {
    throw new SyncError("server", "This device's data already belongs to an account.");
  }
  const settled = deps.commit((base) => base);
  const nowMs = deps.now();
  const sourceId = `import:${meta.deviceId}:${nowMs}`;
  const floor =
    settled.activeActivityId && settled.activeSinceMs !== null && settled.lastProcessedMs !== null
      ? { activityId: settled.activeActivityId, sinceMs: settled.activeSinceMs, floorMs: settled.lastProcessedMs }
      : null;
  const next = addToOutbox({ ...meta, owner: account, floor }, account.userId, {
    activities: settled.activities.map((activity) => toSyncActivity(activity, 0, meta.deviceId)),
    baselines: baselinesFromTracker(settled, sourceId),
  });
  requireSaved(saveSyncMeta(deps.storage, next));
  return runSync(deps, account);
}

/** Merges a guest data set that was kept aside earlier into the signed-in account. */
export async function mergeStashedData(deps: SyncDeps, account: SyncOwner, stashId: string): Promise<SyncRunResult> {
  const meta = loadSyncMeta(deps.storage);
  if (meta.owner?.userId !== account.userId) {
    return { kind: "needs-decision" };
  }
  const stash = loadStash(deps.storage, deps.now());
  const entry = stash.find((item) => item.id === stashId);
  if (!entry || entry.ownerUserId !== null || entry.mergedIntoUserId) {
    throw new SyncError("server", "That data set can't be merged into this account.");
  }
  const next = addToOutbox(meta, account.userId, {
    activities: entry.tracker.activities.map((activity) => toSyncActivity(activity, 0, meta.deviceId)),
    baselines: baselinesFromTracker(entry.tracker, `stash:${entry.id}`),
  });
  requireSaved(saveSyncMeta(deps.storage, next));
  requireSaved(
    saveStash(
      deps.storage,
      stash.map((item) => (item.id === stashId ? { ...item, mergedIntoUserId: account.userId } : item)),
    ),
  );
  return runSync(deps, account);
}

function seedFromSnapshot(snapshot: SyncSnapshot, nowMs: number, deviceId: string): TrackerState {
  const empty: TrackerState = { ...createDefaultTrackerState(nowMs), activities: [] };
  return applySnapshot(empty, snapshot, nowMs, deviceId, null);
}

/**
 * Switches this device to `account`'s data. The current local data is set aside
 * (never deleted, never uploaded) unless it's an untouched fresh install. If this
 * account's own data was set aside here before, it comes back; otherwise the
 * account's cloud data is downloaded first, so nothing switches while offline.
 */
export async function adoptAccount(
  deps: SyncDeps,
  account: SyncOwner,
  options: { keepCurrent: boolean },
): Promise<SyncRunResult> {
  const { userId } = account;
  const startMeta = loadSyncMeta(deps.storage);
  const ownStash = loadStash(deps.storage, deps.now())
    .filter((item) => item.ownerUserId === userId && !item.mergedIntoUserId)
    .sort((a, b) => b.stashedAtMs - a.stashedAtMs)[0];

  let seed: TrackerState | null = ownStash?.tracker ?? null;
  let seedDefaults = false;
  if (!seed) {
    const cache = await pullIntoCache(deps, userId);
    if (!cache) return { kind: "aborted" };
    const snapshot = mergeSnapshots(cache.snapshot, getOutbox(startMeta, userId));
    if (snapshot.activities.length === 0) {
      seedDefaults = true;
      seed = { ...createDefaultTrackerState(deps.now()), activities: DEFAULT_ACTIVITIES };
    } else {
      seed = seedFromSnapshot(snapshot, deps.now(), startMeta.deviceId);
    }
  }
  if (!deps.isCurrent(userId)) return { kind: "aborted" };

  // Stop the timer while the previous owner is still recorded, so its last segment is captured for them.
  const outgoing = deps.commit((base, nowMs) => stopTimer(base, nowMs));
  const stash = loadStash(deps.storage, deps.now()).filter((item) => item.id !== ownStash?.id);
  if (options.keepCurrent) {
    const current = loadSyncMeta(deps.storage);
    stash.push({
      id: `stash-${deps.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ownerUserId: current.owner?.userId ?? null,
      ownerEmail: current.owner?.email ?? null,
      stashedAtMs: deps.now(),
      mergedIntoUserId: null,
      tracker: outgoing,
    } satisfies StashEntry);
  }
  requireSaved(saveStash(deps.storage, stash));

  let meta: SyncMeta = { ...loadSyncMeta(deps.storage), owner: account, floor: null };
  if (seedDefaults) {
    meta = addToOutbox(meta, userId, {
      activities: DEFAULT_ACTIVITIES.map((activity) => toSyncActivity(activity, 0, meta.deviceId)),
    });
  }
  requireSaved(saveSyncMeta(deps.storage, meta));
  const finalSeed = seed;
  deps.commit(() => finalSeed);
  return runSync(deps, account);
}

/**
 * Called before restoring a backup over account data: settles the timer for the
 * account, then marks local data as unowned so the restored file is never uploaded
 * without the user choosing to merge it.
 */
export function detachForRestore(deps: Pick<SyncDeps, "storage" | "commit">): void {
  const meta = loadSyncMeta(deps.storage);
  if (!meta.owner) return;
  deps.commit((base) => base);
  saveSyncMeta(deps.storage, { ...loadSyncMeta(deps.storage), owner: null, floor: null });
}
