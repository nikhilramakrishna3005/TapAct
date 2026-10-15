import { clearCharacterSkipped } from "../duels/character";
import { readDeletionReceipt, writeDeletionReceipt, type DeletionReceipt } from "./deletionReceipt";
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

export type LocalDeletionProgress = {
  /** The Auth deletion was stored on this device. False when storage rejected that write. */
  serverRecorded: boolean;
  deviceCleaned: boolean;
  resetTracker: boolean;
};

function sealId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `seal-${Date.now().toString(36)}`;
}

/**
 * Records Auth deletion and blocks uploads before the rest of cleanup.
 * Calling it again keeps a cleanup that already finished.
 */
export function recordServerDeletion(storage: CleanupStorage | null, userId: string, nowMs: number): { serverRecorded: boolean } {
  if (!storage || !userId) return { serverRecorded: false };
  const existing = readDeletionReceipt(storage);
  if (existing?.userId === userId && existing.deviceCleaned) return { serverRecorded: true };
  const receipt: DeletionReceipt = existing?.userId === userId
    ? existing
    : { userId, serverDeleted: true, deviceCleaned: false, resetTracker: false, sealId: null, atMs: nowMs };
  if (!writeDeletionReceipt(storage, receipt)) return { serverRecorded: false };
  try {
    const meta = loadSyncMeta(storage);
    const blocked = [...new Set([...(meta.blockedUserIds ?? []), userId])].slice(0, 20);
    saveSyncMeta(storage, { ...meta, blockedUserIds: blocked });
  } catch {
    // The receipt alone is enough for sync to stop.
  }
  return { serverRecorded: true };
}

/**
 * Removes this account's local sync ownership and pending upload. Guest data
 * and any other account's stash stay. The deleted id is blocked so a sync
 * already in flight, or a later sign-in attempt, cannot upload it again.
 */
export function forgetDeletedAccount(storage: CleanupStorage | null, userId: string, nowMs: number): LocalDeletionResult {
  if (!storage || !userId) return { resetTracker: false };
  const meta = loadSyncMeta(storage);
  const owned = meta.owner?.userId === userId;
  // Reset the tracker before dropping ownership. A failed write can then be retried
  // while this device still knows the tracker belonged to the deleted account.
  if (owned) {
    storage.setItem(STORAGE_KEY_V3, serializeTrackerState(createDefaultTrackerState(nowMs)));
  }
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

  return { resetTracker: owned };
}

/**
 * Local-only cleanup. Safe to call again after a partial failure. It does not
 * contact Auth and does not remove another account's stash or tracker.
 */
export function cleanupDeletedDevice(storage: CleanupStorage | null, userId: string, nowMs: number): LocalDeletionProgress {
  const recorded = recordServerDeletion(storage, userId, nowMs);
  if (!recorded.serverRecorded || !storage) {
    return { serverRecorded: false, deviceCleaned: false, resetTracker: false };
  }
  const existing = readDeletionReceipt(storage);
  if (existing?.userId === userId && existing.deviceCleaned) {
    return { serverRecorded: true, deviceCleaned: true, resetTracker: existing.resetTracker };
  }
  try {
    const result = forgetDeletedAccount(storage, userId, nowMs);
    const wrote = writeDeletionReceipt(storage, {
      userId,
      serverDeleted: true,
      deviceCleaned: true,
      resetTracker: result.resetTracker,
      sealId: result.resetTracker ? sealId() : null,
      atMs: nowMs,
    });
    if (!wrote) return { serverRecorded: true, deviceCleaned: false, resetTracker: false };
    return { serverRecorded: true, deviceCleaned: true, resetTracker: result.resetTracker };
  } catch {
    return { serverRecorded: true, deviceCleaned: false, resetTracker: false };
  }
}

export function accountUploadBlocked(storage: WritableStorageLike | null, userId: string): boolean {
  return isAccountBlocked(loadSyncMeta(storage), userId);
}
