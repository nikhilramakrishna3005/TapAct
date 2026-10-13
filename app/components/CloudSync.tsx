"use client";

import { AnimatePresence } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TrackerState } from "@/lib/tracker";
import type { TrackerUpdate, WritableStorageLike } from "@/lib/trackerStore";
import { SYNC_DIRTY_EVENT } from "@/lib/sync/capture";
import {
  adoptAccount,
  detachForRestore,
  importLocalData,
  mergeStashedData,
  runSync,
  type SyncDeps,
  type SyncRunResult,
} from "@/lib/sync/engine";
import { runningSegment } from "@/lib/sync/merge";
import { type RescueResult, rescueSession as applyRescue, type SessionChange } from "@/lib/sync/rescue";
import { classifyRemoteError, createSupabaseRemote, SyncError } from "@/lib/sync/remote";
import {
  decideOwnership,
  getOutbox,
  loadStash,
  loadSyncMeta,
  type OwnershipDecision,
  outboxSize,
  type StashEntry,
  SYNC_META_KEY,
  SYNC_STASH_KEY,
  type SyncMeta,
  type SyncOwner,
} from "@/lib/sync/state";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { SyncPrompt } from "./SyncPrompt";

export type SyncStatus =
  | "unavailable"
  | "checking"
  | "signed-out"
  | "action-needed"
  | "offline"
  | "syncing"
  | "synced"
  | "error";

type CommitWithSource = (update: TrackerUpdate, options?: { source?: "sync" }) => { state: TrackerState };

type CloudSyncValue = {
  status: SyncStatus;
  errorMessage: string | null;
  lastSyncedAtMs: number | null;
  pending: number;
  /** Account that owns the tracker data on this device (null for guest data). */
  dataOwner: SyncOwner | null;
  decision: OwnershipDecision | null;
  guestStashes: StashEntry[];
  otherAccountStashCount: number;
  busy: boolean;
  syncNow: () => void;
  openPrompt: () => void;
  importLocal: () => Promise<void>;
  keepLocalAside: () => Promise<void>;
  mergeStash: (stashId: string) => Promise<void>;
  /** Must run before a backup restore replaces account-owned data. */
  beforeRestore: () => void;
  /** Edits, adds or deletes a recorded session (queued offline, synced in the background). */
  rescueSession: (change: SessionChange) => RescueResult;
};

const CloudSyncContext = createContext<CloudSyncValue | null>(null);

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];
const DIRTY_DEBOUNCE_MS = 3_000;
const PERIODIC_MS = 120_000;

function getStorage(): WritableStorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let tabInFlight = false;

/** One sync at a time across tabs (Web Locks), falling back to a per-tab guard. */
async function withSyncLock<T>(task: () => Promise<T>): Promise<T | null> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (tabInFlight) return null;
  tabInFlight = true;
  try {
    if (locks?.request) {
      return await locks.request("tapact-cloud-sync", { ifAvailable: true }, async (lock) => (lock ? task() : null));
    }
    return await task();
  } finally {
    tabInFlight = false;
  }
}

export function CloudSyncProvider({
  commit,
  tracker,
  children,
}: {
  commit: CommitWithSource;
  tracker: TrackerState;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const account: SyncOwner | null = useMemo(
    () => (auth.status === "signed-in" && auth.account ? { userId: auth.account.id, email: auth.account.email } : null),
    [auth.account, auth.status],
  );
  const accountRef = useRef<SyncOwner | null>(account);
  accountRef.current = account;

  const [meta, setMeta] = useState<SyncMeta | null>(null);
  const [stash, setStash] = useState<StashEntry[]>([]);
  const [phase, setPhase] = useState<"idle" | "syncing">("idle");
  const [error, setError] = useState<SyncError | null>(null);
  const [online, setOnline] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const dismissedForRef = useRef<string | null>(null);
  const failuresRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const adoptingRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    const storage = getStorage();
    setMeta(loadSyncMeta(storage));
    setStash(loadStash(storage, Date.now()));
  }, []);

  useEffect(() => {
    refresh();
    setOnline(navigator.onLine);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SYNC_META_KEY || event.key === SYNC_STASH_KEY) refresh();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refresh]);

  const deps = useMemo<SyncDeps | null>(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    return {
      storage: getStorage(),
      remote: createSupabaseRemote(client),
      commit: (update) => commit(update, { source: "sync" }).state,
      now: () => Date.now(),
      isCurrent: (userId) => accountRef.current?.userId === userId,
    };
  }, [commit]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const perform = useCallback(
    async (action: (deps: SyncDeps, owner: SyncOwner) => Promise<SyncRunResult>): Promise<boolean> => {
      const owner = accountRef.current;
      if (!deps || !owner) return false;
      if (!navigator.onLine) {
        setOnline(false);
        return false;
      }
      setPhase("syncing");
      let ok = false;
      try {
        const result = await withSyncLock(() => action(deps, owner));
        if (result?.kind === "synced") {
          failuresRef.current = 0;
          setError(null);
          ok = true;
        }
      } catch (caught) {
        const syncError = caught instanceof SyncError ? caught : classifyRemoteError(caught);
        if (accountRef.current?.userId === owner.userId) {
          setError(syncError);
          if (syncError.kind === "offline" || syncError.kind === "server") {
            const delay = RETRY_DELAYS_MS[Math.min(failuresRef.current, RETRY_DELAYS_MS.length - 1)];
            failuresRef.current += 1;
            clearTimer();
            timerRef.current = window.setTimeout(() => void perform(runSync), delay);
          }
        }
      } finally {
        setPhase("idle");
        refresh();
      }
      return ok;
    },
    [deps, refresh],
  );

  const decision = useMemo(
    () => (account && meta ? decideOwnership(meta, tracker, account.userId) : null),
    [account, meta, tracker],
  );
  const inSync = decision?.kind === "in-sync";

  const schedule = useCallback(
    (delayMs: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => void perform(runSync), delayMs);
    },
    [perform],
  );

  // Account changes: drop pending work and errors that belonged to the previous account.
  useEffect(() => {
    clearTimer();
    failuresRef.current = 0;
    setError(null);
    setPromptOpen(false);
  }, [account?.userId]);

  const decisionKind = decision?.kind ?? null;
  const accountId = account?.userId ?? null;
  useEffect(() => {
    if (!accountId || !decisionKind) return;
    if (decisionKind === "in-sync") {
      schedule(0);
    } else if (decisionKind === "adopt-pristine" && online && adoptingRef.current !== accountId) {
      adoptingRef.current = accountId;
      void perform((d, owner) => adoptAccount(d, owner, { keepCurrent: false })).then(() => {
        adoptingRef.current = null;
      });
    } else if (
      (decisionKind === "guest-data" || decisionKind === "other-account") &&
      dismissedForRef.current !== accountId
    ) {
      setPromptOpen(true);
    }
  }, [accountId, decisionKind, online, perform, schedule]);

  useEffect(() => {
    if (!inSync) return;
    const handleDirty = () => schedule(DIRTY_DEBOUNCE_MS);
    const handleOnline = () => {
      setOnline(true);
      failuresRef.current = 0;
      schedule(0);
    };
    const handleOffline = () => setOnline(false);
    const handleVisible = () => {
      if (document.visibilityState === "visible") schedule(500);
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") schedule(0);
    }, PERIODIC_MS);
    window.addEventListener(SYNC_DIRTY_EVENT, handleDirty);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(SYNC_DIRTY_EVENT, handleDirty);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisible);
      clearTimer();
    };
  }, [inSync, schedule]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // The running timer's segment grows continuously and uploads on every sync, so it isn't a backlog.
  const liveSegmentId = meta ? runningSegment(tracker, meta.deviceId, meta.floor)?.id : undefined;
  const pending = useMemo(() => {
    if (!account || !meta) return 0;
    const outbox = getOutbox(meta, account.userId);
    return outboxSize(outbox) - outbox.entries.filter((entry) => entry.id === liveSegmentId).length;
  }, [account, liveSegmentId, meta]);
  const lastSyncedAtMs = account && meta?.lastSyncedUserId === account.userId ? meta.lastSyncedAtMs : null;

  let status: SyncStatus;
  if (auth.status === "unavailable" || !deps) status = auth.status === "loading" ? "checking" : "unavailable";
  else if (auth.status === "loading" || (account && !meta)) status = "checking";
  else if (!account) status = "signed-out";
  else if (decision?.kind === "guest-data" || decision?.kind === "other-account") status = "action-needed";
  else if (error?.kind === "auth" || error?.kind === "not-set-up") status = error.kind === "auth" ? "action-needed" : "error";
  else if (phase === "syncing") status = "syncing";
  else if (!online) status = "offline";
  else if (error) status = "error";
  else if (inSync && pending === 0 && lastSyncedAtMs !== null) status = "synced";
  else status = "syncing";

  const errorMessage =
    status === "error" || (status === "action-needed" && error?.kind === "auth") ? (error?.message ?? null) : null;

  const syncNow = useCallback(() => {
    clearTimer();
    failuresRef.current = 0;
    void perform(runSync);
  }, [perform]);

  const importLocal = useCallback(async () => {
    if (await perform(importLocalData)) setPromptOpen(false);
  }, [perform]);

  const keepLocalAside = useCallback(async () => {
    if (await perform((d, owner) => adoptAccount(d, owner, { keepCurrent: true }))) setPromptOpen(false);
  }, [perform]);

  const mergeStash = useCallback(
    async (stashId: string) => {
      await perform((d, owner) => mergeStashedData(d, owner, stashId));
    },
    [perform],
  );

  const beforeRestore = useCallback(() => {
    clearTimer();
    detachForRestore({ storage: getStorage(), commit: (update) => commit(update, { source: "sync" }).state });
    dismissedForRef.current = null;
    refresh();
  }, [commit, refresh]);

  const trackerRef = useRef(tracker);
  trackerRef.current = tracker;
  const rescueSession = useCallback(
    (change: SessionChange) => {
      const result = applyRescue(
        { storage: getStorage(), commit: (update) => commit(update, { source: "sync" }).state, now: () => Date.now() },
        trackerRef.current,
        change,
      );
      if (result.ok) {
        refresh();
        window.dispatchEvent(new Event(SYNC_DIRTY_EVENT));
      }
      return result;
    },
    [commit, refresh],
  );

  const closePrompt = useCallback(() => {
    dismissedForRef.current = accountRef.current?.userId ?? null;
    setPromptOpen(false);
  }, []);

  const value = useMemo<CloudSyncValue>(
    () => ({
      status,
      errorMessage,
      lastSyncedAtMs,
      pending,
      dataOwner: meta?.owner ?? null,
      decision,
      guestStashes: stash.filter((item) => item.ownerUserId === null),
      otherAccountStashCount: stash.filter((item) => item.ownerUserId !== null && item.ownerUserId !== account?.userId)
        .length,
      busy: phase === "syncing",
      syncNow,
      openPrompt: () => setPromptOpen(true),
      importLocal,
      keepLocalAside,
      mergeStash,
      beforeRestore,
      rescueSession,
    }),
    [
      account?.userId,
      beforeRestore,
      rescueSession,
      decision,
      errorMessage,
      importLocal,
      keepLocalAside,
      lastSyncedAtMs,
      mergeStash,
      meta?.owner,
      pending,
      phase,
      stash,
      status,
      syncNow,
    ],
  );

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {promptOpen && account && decision && (decision.kind === "guest-data" || decision.kind === "other-account") && (
          <SyncPrompt
            key="sync-prompt"
            decision={decision}
            account={account}
            tracker={tracker}
            busy={phase === "syncing"}
            online={online}
            errorMessage={error?.message ?? null}
            onMerge={importLocal}
            onKeepAside={keepLocalAside}
            onClose={closePrompt}
          />
        )}
      </AnimatePresence>
    </CloudSyncContext.Provider>
  );
}

export function useCloudSync(): CloudSyncValue {
  const value = useContext(CloudSyncContext);
  if (!value) {
    throw new Error("useCloudSync must be used inside CloudSyncProvider");
  }
  return value;
}
