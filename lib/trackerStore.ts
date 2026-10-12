import {
  createDefaultTrackerState,
  loadTrackerState,
  processActiveTimer,
  serializeTrackerState,
  STORAGE_KEY_V3,
  type StorageLike,
  type TrackerState,
} from "./tracker";

export type WritableStorageLike = StorageLike & {
  setItem: (key: string, value: string) => void;
};

export type PersistFailureReason = "quota" | "unavailable";

export type CommitResult = {
  state: TrackerState;
  persisted: boolean;
  failureReason: PersistFailureReason | null;
};

export type TrackerUpdate = (base: TrackerState, nowMs: number) => TrackerState;

export function classifyStorageError(error: unknown): PersistFailureReason {
  if (error && typeof error === "object") {
    const { name, code } = error as { name?: unknown; code?: unknown };
    if (
      name === "QuotaExceededError" ||
      name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      code === 22 ||
      code === 1014
    ) {
      return "quota";
    }
  }
  return "unavailable";
}

function readStoredState(storage: StorageLike | null, nowMs: number): TrackerState | null {
  if (!storage) {
    return null;
  }
  try {
    return loadTrackerState(storage, nowMs);
  } catch {
    return null;
  }
}

/**
 * Picks the newer of this tab's in-memory state and the persisted state.
 * Ties go to storage so that a successful write from another tab wins over
 * a local copy that was never persisted at that revision.
 */
export function selectLatestState(
  memory: TrackerState | null,
  stored: TrackerState | null,
  nowMs: number,
): TrackerState {
  if (!stored) {
    return processActiveTimer(memory ?? createDefaultTrackerState(nowMs), nowMs);
  }
  if (memory && memory.revision > stored.revision) {
    return processActiveTimer(memory, nowMs);
  }
  return stored;
}

export function syncFromStorage(
  storage: StorageLike | null,
  memory: TrackerState | null,
  nowMs: number,
): TrackerState {
  return selectLatestState(memory, readStoredState(storage, nowMs), nowMs);
}

/**
 * Read-modify-write against the latest persisted state, so a tab with stale
 * in-memory data applies its change on top of other tabs' writes instead of
 * overwriting them.
 */
export function commitTrackerUpdate(
  storage: WritableStorageLike | null,
  memory: TrackerState | null,
  update: TrackerUpdate,
  nowMs: number,
): CommitResult {
  const base = syncFromStorage(storage, memory, nowMs);
  const next: TrackerState = { ...update(base, nowMs), revision: base.revision + 1 };

  if (!storage) {
    return { state: next, persisted: false, failureReason: "unavailable" };
  }

  try {
    storage.setItem(STORAGE_KEY_V3, serializeTrackerState(next));
    return { state: next, persisted: true, failureReason: null };
  } catch (error) {
    return { state: next, persisted: false, failureReason: classifyStorageError(error) };
  }
}
