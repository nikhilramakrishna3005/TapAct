import { clearCharacterSkipped } from "../duels/character";
import { createDefaultTrackerState, serializeTrackerState, STORAGE_KEY_V3 } from "../tracker";
import type { WritableStorageLike } from "../trackerStore";
import {
  isAccountBlocked,
  loadStash,
  loadSyncMeta,
  saveStash,
  saveSyncMeta,
  SYNC_CACHE_KEY,
  type SyncMeta,
} from "../sync/state";

type CleanupStorage = WritableStorageLike & {
  removeItem?: (key: string) => void;
};

export type LocalDeletionResult = {
  /** The tracker on this device belonged to the deleted account and was reset. */
  resetTracker: boolean;
};

/**
 * Removes this account's local sync ownership and pending upload. Guest data
 * and any other account's stash stay. The deleted id is blocked so a sync
 * already in flight, or a later sign-in attempt, cannot upload it again.
 */
export function forgetDeletedAccount(storage: CleanupStorage | null, userId: string, nowMs: number): LocalDeletionResult {
  if (!storage || !userId) return { resetTracker: false };
  const meta = loadSyncMeta(storage);
  const owned = meta.owner?.userId === userId;
  const blocked = [...new Set([...(meta.blockedUserIds ?? []), userId])].slice(0, 20);
  const next: SyncMeta = {
    ...meta,
    owner: owned ? null : meta.owner,
    floor: owned ? null : meta.floor,
    outboxes: meta.outboxes.filter((outbox) => outbox.userId !== userId),
    lastSyncedUserId: meta.lastSyncedUserId === userId ? null : meta.lastSyncedUserId,
    blockedUserIds: blocked,
  };
  saveSyncMeta(storage, next);

  if (storage.removeItem) {
    const rawCache = storage.getItem(SYNC_CACHE_KEY);
    if (rawCache) {
      try {
        const parsed = JSON.parse(rawCache) as { userId?: unknown };
        if (parsed.userId === userId) storage.removeItem(SYNC_CACHE_KEY);
      } catch {
        // A cache that cannot be read cannot be attributed to this account.
      }
    }
  }

  const stash = loadStash(storage, nowMs).filter((item) => item.ownerUserId !== userId);
  saveStash(storage, stash);
  if (storage.removeItem) {
    const removeItem = storage.removeItem.bind(storage);
    clearCharacterSkipped(
      {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => storage.setItem(key, value),
        removeItem,
      },
      userId,
    );
  }

  if (owned) {
    storage.setItem(STORAGE_KEY_V3, serializeTrackerState(createDefaultTrackerState(nowMs)));
  }
  return { resetTracker: owned };
}

export function accountUploadBlocked(storage: WritableStorageLike | null, userId: string): boolean {
  return isAccountBlocked(loadSyncMeta(storage), userId);
}
