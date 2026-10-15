export const DELETION_RECEIPT_KEY = "tapact.account.deletion.v1";
export const DELETION_SEAL_APPLIED_KEY = "tapact.account.deletion.applied";

export type DeletionReceipt = {
  userId: string;
  serverDeleted: true;
  deviceCleaned: boolean;
  resetTracker: boolean;
  sealId: string | null;
  atMs: number;
};

type ReadableStore = {
  getItem: (key: string) => string | null;
};

/** Auth deletion is recorded here before device cleanup, so a storage failure cannot hide that the account is gone. */
export function readDeletionReceipt(storage: ReadableStore | null): DeletionReceipt | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DELETION_RECEIPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeletionReceipt>;
    if (parsed.serverDeleted !== true) return null;
    if (typeof parsed.userId !== "string" || parsed.userId.length === 0 || parsed.userId.length > 64) return null;
    const sealId =
      typeof parsed.sealId === "string" && parsed.sealId.length > 0 && parsed.sealId.length <= 80 ? parsed.sealId : null;
    return {
      userId: parsed.userId,
      serverDeleted: true,
      deviceCleaned: parsed.deviceCleaned === true,
      resetTracker: parsed.resetTracker === true,
      sealId,
      atMs: typeof parsed.atMs === "number" && Number.isFinite(parsed.atMs) ? parsed.atMs : 0,
    };
  } catch {
    return null;
  }
}

export function writeDeletionReceipt(
  storage: (ReadableStore & { setItem: (key: string, value: string) => void }) | null,
  receipt: DeletionReceipt,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DELETION_RECEIPT_KEY, JSON.stringify(receipt));
    return true;
  } catch {
    return false;
  }
}

/** True once Auth deletion has been recorded for this account, even if device cleanup has not finished. */
export function deletionStopsSync(storage: ReadableStore | null, userId: string): boolean {
  const receipt = readDeletionReceipt(storage);
  return receipt?.serverDeleted === true && receipt.userId === userId;
}

/**
 * A seal means this tab has not yet adopted the reset tracker. Until it does,
 * a higher in-memory revision must not win, or a stale tab would put the
 * deleted account's activities back.
 */
export function pendingDeletionSeal(storage: ReadableStore | null, session: ReadableStore | null): string | null {
  const receipt = readDeletionReceipt(storage);
  if (!receipt?.resetTracker || !receipt.sealId) return null;
  if (session?.getItem(DELETION_SEAL_APPLIED_KEY) === receipt.sealId) return null;
  return receipt.sealId;
}

/** A tracker write that started before the seal must not land after it. */
export function staleTrackerWrite(sealAtStart: string | null, sealNow: string | null): boolean {
  return Boolean(sealNow && sealNow !== sealAtStart);
}
