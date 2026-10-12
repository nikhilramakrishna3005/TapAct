import type { TrackerState } from "../tracker";
import type { WritableStorageLike } from "../trackerStore";
import { runningSegment, sameActivityFields, type SyncActivity, type TimeEntry, toSyncActivity } from "./merge";
import { addToOutbox, loadSyncMeta, saveSyncMeta, type SyncMeta } from "./state";

export const SYNC_DIRTY_EVENT = "tapact:sync-dirty";

/** Storage wrapper used by the app after every tracker commit. Returns true if anything was queued. */
export function recordCommit(
  storage: WritableStorageLike | null,
  base: TrackerState,
  next: TrackerState,
  nowMs: number,
  options: CaptureOptions,
): boolean {
  if (!storage) return false;
  try {
    const meta = loadSyncMeta(storage);
    if (!meta.owner) return false;
    const updated = captureCommit(meta, base, next, nowMs, options);
    if (updated === meta) return false;
    saveSyncMeta(storage, updated);
    return true;
  } catch {
    return false;
  }
}

export type CaptureOptions = {
  /** False for commits made by the sync engine itself, which must not be re-uploaded as edits. */
  captureActivities: boolean;
};

/**
 * Records what a single tracker commit changed into the owner's outbox. `base` is the
 * state the commit started from (already settled to the commit time) and `next` the
 * result, so the running segment's end is exact even when the commit stops the timer.
 * Guest data (no owner) records nothing; it can be imported later as a whole.
 */
export function captureCommit(
  meta: SyncMeta,
  base: TrackerState,
  next: TrackerState,
  nowMs: number,
  options: CaptureOptions,
): SyncMeta {
  if (!meta.owner) {
    return meta;
  }
  const entries: TimeEntry[] = [];
  for (const state of [base, next]) {
    const segment = runningSegment(state, meta.deviceId, meta.floor);
    if (segment) entries.push(segment);
  }

  const activities: SyncActivity[] = [];
  if (options.captureActivities) {
    const before = new Map(base.activities.map((activity) => [activity.id, activity]));
    for (const activity of next.activities) {
      const previous = before.get(activity.id);
      if (!previous || !sameActivityFields(previous, activity)) {
        activities.push(toSyncActivity(activity, nowMs, meta.deviceId));
      }
    }
  }

  const floor =
    meta.floor && next.activeActivityId === meta.floor.activityId && next.activeSinceMs === meta.floor.sinceMs
      ? meta.floor
      : null;

  if (entries.length === 0 && activities.length === 0 && floor === meta.floor) {
    return meta;
  }
  return { ...addToOutbox(meta, meta.owner.userId, { entries, activities }), floor };
}
