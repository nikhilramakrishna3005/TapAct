import type { Activity, TrackerState } from "../tracker";
import type { WritableStorageLike } from "../trackerStore";
import type { EngineCommit } from "./engine";
import { applySnapshot, isLiveEntry, mergeEntryLists, mergeSnapshots, runningSegment, type TimeEntry } from "./merge";
import { addToOutbox, getOutbox, loadSyncCache, loadSyncMeta, saveSyncMeta, type SyncMeta } from "./state";

export const MIN_SESSION_MS = 60_000;
export const MAX_SESSION_MS = 24 * 60 * 60_000;
const EARLIEST_SESSION_MS = new Date(2000, 0, 1).getTime();
/** Allows "now" picked in a minute-precision field. */
const FUTURE_TOLERANCE_MS = 60_000;

export type SessionDraft = { activityId: string; startMs: number; endMs: number };

/** `replaceIds` are the recorded entries behind the session being edited or deleted (empty when adding). */
export type SessionChange =
  | { kind: "save"; replaceIds: string[]; draft: SessionDraft }
  | { kind: "delete"; replaceIds: string[] };

export type SessionProblem = { message: string; conflict?: TimeEntry };

export type RescueResult = { ok: true } | { ok: false; problem: SessionProblem };

/** The running timer on this device occupies everything from its start onwards. */
type RunningTimer = { activityId: string; startMs: number } | null;

export function getRunningTimer(state: TrackerState): RunningTimer {
  return state.activeActivityId && state.activeSinceMs !== null
    ? { activityId: state.activeActivityId, startMs: state.activeSinceMs }
    : null;
}

export function validateSessionDraft(
  draft: SessionDraft,
  context: {
    entries: TimeEntry[];
    replaceIds: string[];
    running: RunningTimer;
    activities: Activity[];
    nowMs: number;
    /** Archived activities can only be kept, not newly chosen. */
    originalActivityId?: string;
  },
): SessionProblem | null {
  const activity = context.activities.find((item) => item.id === draft.activityId);
  if (!activity || (activity.archivedAtMs !== null && draft.activityId !== context.originalActivityId)) {
    return { message: "Choose an activity for this session." };
  }
  if (!Number.isFinite(draft.startMs) || !Number.isFinite(draft.endMs)) {
    return { message: "Enter a valid start and end." };
  }
  if (draft.startMs < EARLIEST_SESSION_MS) {
    return { message: "That date is too far in the past." };
  }
  if (draft.endMs <= draft.startMs) {
    return { message: "End must be after start." };
  }
  if (draft.endMs - draft.startMs < MIN_SESSION_MS) {
    return { message: "Sessions must be at least 1 minute long." };
  }
  if (draft.endMs - draft.startMs > MAX_SESSION_MS) {
    return { message: "Sessions can be at most 24 hours long." };
  }
  if (draft.endMs > context.nowMs + FUTURE_TOLERANCE_MS) {
    return { message: "Sessions can't end in the future." };
  }
  if (context.running && draft.endMs > context.running.startMs) {
    return {
      message: "This overlaps the timer that's running now.",
      conflict: {
        id: "running",
        activityId: context.running.activityId,
        deviceId: "",
        startMs: context.running.startMs,
        endMs: context.nowMs,
      },
    };
  }
  const replaced = new Set(context.replaceIds);
  const conflict = context.entries
    .filter((entry) => isLiveEntry(entry) && !replaced.has(entry.id))
    .filter((entry) => draft.startMs < entry.endMs && draft.endMs > entry.startMs)
    .sort((a, b) => a.startMs - b.startMs)[0];
  if (conflict) {
    return { message: "This overlaps another session.", conflict };
  }
  return null;
}

export function createManualEntryId(deviceId: string, nowMs: number): string {
  return `manual:${deviceId}:${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Queues tombstones for the replaced entries and the new manual entry, if any. */
export function applySessionChange(
  meta: SyncMeta,
  known: TimeEntry[],
  change: SessionChange,
  nowMs: number,
  makeId: (deviceId: string, nowMs: number) => string = createManualEntryId,
): SyncMeta {
  if (!meta.owner) {
    return meta;
  }
  const replaced = new Set(change.replaceIds);
  const tombstones = known
    .filter((entry) => replaced.has(entry.id) && isLiveEntry(entry))
    .map((entry): TimeEntry => ({ ...entry, deletedAtMs: nowMs }));
  const entries = [...tombstones];
  if (change.kind === "save") {
    entries.push({
      id: makeId(meta.deviceId, nowMs),
      activityId: change.draft.activityId,
      deviceId: meta.deviceId,
      startMs: Math.round(change.draft.startMs),
      endMs: Math.round(change.draft.endMs),
      source: "manual",
    });
  }
  return addToOutbox(meta, meta.owner.userId, { entries });
}

/** Every session known on this device for the owning account (cache plus not-yet-uploaded). */
export function loadKnownEntries(storage: WritableStorageLike | null, meta: SyncMeta): TimeEntry[] {
  if (!meta.owner) return [];
  const cache = loadSyncCache(storage, meta.owner.userId);
  return mergeEntryLists(cache.snapshot.entries, getOutbox(meta, meta.owner.userId).entries);
}

/**
 * Applies a session correction offline-first: it is queued for upload and the local
 * totals are rebuilt from the same records a sync uses, so History, Insights and the
 * timeline agree immediately. The running timer is never touched.
 */
export function rescueSession(
  deps: { storage: WritableStorageLike | null; commit: EngineCommit; now: () => number },
  tracker: TrackerState,
  change: SessionChange,
): RescueResult {
  const meta = loadSyncMeta(deps.storage);
  const owner = meta.owner;
  if (!owner) {
    return { ok: false, problem: { message: "Sign in and sync to edit sessions." } };
  }
  if (meta.lastSyncedUserId !== owner.userId) {
    return { ok: false, problem: { message: "Sync once with your account before editing sessions." } };
  }
  const nowMs = deps.now();
  const known = loadKnownEntries(deps.storage, meta);
  const runningId = runningSegment(tracker, meta.deviceId, meta.floor)?.id;
  if (runningId && change.replaceIds.includes(runningId)) {
    return { ok: false, problem: { message: "Stop the timer before changing this session." } };
  }
  if (change.kind === "save") {
    const original = known.find((entry) => change.replaceIds.includes(entry.id));
    const problem = validateSessionDraft(change.draft, {
      entries: known,
      replaceIds: change.replaceIds,
      running: getRunningTimer(tracker),
      activities: tracker.activities,
      nowMs,
      originalActivityId: original?.activityId,
    });
    if (problem) {
      return { ok: false, problem };
    }
  }

  const next = applySessionChange(meta, known, change, nowMs);
  if (!saveSyncMeta(deps.storage, next)) {
    return { ok: false, problem: { message: "This device's storage is full, so the change couldn't be saved." } };
  }
  const cache = loadSyncCache(deps.storage, owner.userId);
  const merged = mergeSnapshots(cache.snapshot, getOutbox(next, owner.userId));
  deps.commit((base, commitMs) => applySnapshot(base, merged, commitMs, next.deviceId, next.floor));
  return { ok: true };
}
