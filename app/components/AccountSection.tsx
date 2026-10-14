"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  BadgeCheck,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudOff,
  LogIn,
  LogOut,
  MailWarning,
  RefreshCw,
  UserPlus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getInitials } from "@/lib/auth/account";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { summarizeState } from "@/lib/backup";
import { useAuth } from "./AuthProvider";
import { type SyncStatus, useCloudSync } from "./CloudSync";
import { downloadBackup } from "./downloadBackup";
import { formatSummaryDuration, SectionCard } from "./ui";

const RETURN_TO_SETTINGS = encodeURIComponent("/?tab=settings");

const STATUS_STYLE: Record<SyncStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  synced: { label: "Synced", tone: "border-mint/35 text-mint", icon: <CloudCheck className="size-3.5" aria-hidden="true" /> },
  syncing: {
    label: "Syncing",
    tone: "border-ice/35 text-ice",
    icon: <RefreshCw className="busy-spin-icon size-3.5" aria-hidden="true" />,
  },
  offline: { label: "Offline", tone: "border-line-strong text-text-2", icon: <CloudOff className="size-3.5" aria-hidden="true" /> },
  "action-needed": {
    label: "Action needed",
    tone: "border-ember/40 text-ember",
    icon: <AlertTriangle className="size-3.5" aria-hidden="true" />,
  },
  error: { label: "Error", tone: "border-danger/40 text-danger", icon: <CloudAlert className="size-3.5" aria-hidden="true" /> },
  checking: { label: "Checking", tone: "border-line-strong text-text-3", icon: <Cloud className="size-3.5" aria-hidden="true" /> },
  "signed-out": { label: "Off", tone: "border-line-strong text-text-3", icon: <CloudOff className="size-3.5" aria-hidden="true" /> },
  unavailable: { label: "Unavailable", tone: "border-line-strong text-text-3", icon: <CloudOff className="size-3.5" aria-hidden="true" /> },
};

function formatSyncTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const sameDay = new Date(ms).toDateString() === new Date().toDateString();
  return new Date(ms).toLocaleString(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function describeStatus(status: SyncStatus, sync: ReturnType<typeof useCloudSync>, email: string | null): string {
  switch (status) {
    case "synced":
      return `Your activities, goals and history are backed up to ${email ?? "your account"} and stay in sync across devices.`;
    case "syncing":
      return sync.pending > 0
        ? `Uploading ${sync.pending} change${sync.pending === 1 ? "" : "s"}. Not backed up until the server confirms.`
        : "Checking for changes from your other devices.";
    case "offline":
      return sync.pending > 0
        ? `You're offline. ${sync.pending} change${sync.pending === 1 ? " is" : "s are"} saved on this device and will sync when you reconnect.`
        : "You're offline. Tracking keeps working and syncs when you reconnect.";
    case "action-needed":
      return sync.decision?.kind === "other-account"
        ? "This device holds data from a different account. Choose what to do before syncing starts."
        : sync.decision?.kind === "guest-data"
          ? "This device has activity that isn't in your account yet. Choose whether to merge it before syncing starts."
          : "Sign in again to continue syncing. Your activity is safe on this device.";
    case "error":
      return "Sync didn't complete. Your activity is safe on this device and TapAct will retry automatically.";
    default:
      return "";
  }
}

function CloudSyncCard({ email }: { email: string | null }) {
  const sync = useCloudSync();
  const style = STATUS_STYLE[sync.status];
  const needsDecision = sync.decision?.kind === "guest-data" || sync.decision?.kind === "other-account";
  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-text-1">
          <Cloud className="size-3.5 text-text-3" aria-hidden="true" />
          Cloud sync
        </p>
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${style.tone}`}
        >
          {style.icon}
          {style.label}
        </span>
      </div>
      <p className="mt-2 text-[0.72rem] leading-relaxed text-text-3">{describeStatus(sync.status, sync, email)}</p>
      {sync.errorMessage && <p className="mt-1.5 text-[0.72rem] leading-relaxed text-danger">{sync.errorMessage}</p>}
      <dl className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-3 text-[0.72rem]">
          <dt className="text-text-3">Last synced</dt>
          <dd className="font-medium text-text-1">{sync.lastSyncedAtMs ? formatSyncTime(sync.lastSyncedAtMs) : "Not yet"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 text-[0.72rem]">
          <dt className="text-text-3">Synced data belongs to</dt>
          <dd className="truncate font-medium text-text-1">{email ?? "This account"}</dd>
        </div>
      </dl>
      {needsDecision ? (
        <button type="button" onClick={sync.openPrompt} className="btn btn-electric mt-3 h-11 w-full">
          Review this device&apos;s data
        </button>
      ) : (
        <button
          type="button"
          onClick={sync.syncNow}
          disabled={sync.busy || sync.status === "offline" || sync.status === "checking"}
          aria-busy={sync.busy}
          className="btn btn-ghost mt-3 h-11 w-full"
        >
          <RefreshCw className={`size-4 ${sync.busy ? "busy-spin-icon" : ""}`} aria-hidden="true" />
          {sync.busy ? "Syncing…" : "Sync now"}
        </button>
      )}
      <StashList />
    </div>
  );
}

function StashList() {
  const sync = useCloudSync();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const canMerge = sync.decision?.kind === "in-sync";
  const visible = sync.guestStashes;
  if (visible.length === 0 && sync.otherAccountStashCount === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {visible.map((item) => {
        const summary = summarizeState(item.tracker, null);
        return (
          <div key={item.id} className="rounded-xl border border-line px-3 py-2.5">
            <p className="text-xs font-semibold text-text-1">Guest data kept on this device</p>
            <p className="mt-0.5 text-[0.7rem] text-text-3">
              {summary.dayCount} days · {formatSummaryDuration(summary.totalMs)} · set aside{" "}
              {new Date(item.stashedAtMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {item.mergedIntoUserId ? " · merged into your account" : ""}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setDownloadFailed(!downloadBackup(item.tracker, "guest"))}
                className="min-h-9 flex-1 rounded-full border border-line-strong px-3 text-xs font-medium text-text-1"
              >
                Download backup
              </button>
              {canMerge && !item.mergedIntoUserId && (
                <button
                  type="button"
                  disabled={sync.busy}
                  onClick={() => {
                    if (window.confirm("Merge this guest data into your account? Only do this if it's your data and isn't already in this account.")) {
                      void sync.mergeStash(item.id);
                    }
                  }}
                  className="min-h-9 flex-1 rounded-full border border-volt/45 bg-volt/[0.09] px-3 text-xs font-medium text-text-1 disabled:opacity-50"
                >
                  Merge into account
                </button>
              )}
            </div>
          </div>
        );
      })}
      {downloadFailed && <p role="alert" className="text-[0.7rem] text-danger">Couldn&apos;t create the backup file.</p>}
      {sync.otherAccountStashCount > 0 && (
        <p className="text-[0.7rem] leading-relaxed text-text-3">
          Data from {sync.otherAccountStashCount === 1 ? "another account is" : `${sync.otherAccountStashCount} other accounts are`} kept
          on this device and returns when that account signs in here.
        </p>
      )}
    </div>
  );
}

function SignedOutDataNote() {
  const sync = useCloudSync();
  if (!sync.dataOwner) {
    return (
      <p className="mt-3 text-[0.72rem] leading-relaxed text-text-3">
        Sign in to back up your activities and sync them across devices. You choose whether this device&apos;s data
        joins your account.
      </p>
    );
  }
  return (
    <p className="mt-3 rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-2.5 text-[0.72rem] leading-relaxed text-text-3">
      This device keeps a copy of{" "}
      <b className="font-semibold text-text-1 [overflow-wrap:anywhere]">{sync.dataOwner.email ?? "your account"}</b>
      &apos;s data. New activity is saved here and syncs when that account signs in again.
    </p>
  );
}

export function AccountSection() {
  const { status, account, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SectionCard title="Account" aside={<UserRound className="size-4 text-text-3" />}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: DURATION.quick, ease: EASE_OUT }}
        >
          {status === "loading" && (
            <div className="flex items-center gap-3" role="status" aria-label="Checking account">
              <span className="size-11 animate-pulse rounded-full bg-[var(--track-soft)]" />
              <div className="flex-1 space-y-2">
                <span className="block h-3 w-1/2 animate-pulse rounded bg-[var(--track-soft)]" />
                <span className="block h-3 w-3/4 animate-pulse rounded bg-[var(--wash)]" />
              </div>
            </div>
          )}

          {status === "unavailable" && (
            <p className="text-xs leading-relaxed text-text-2">
              Accounts aren&apos;t available in this version of TapAct. Everything works as a guest, and your
              activity stays on this device.
            </p>
          )}

          {status === "signed-out" && (
            <>
              <p className="text-xs leading-relaxed text-text-2">
                You&apos;re using TapAct as a guest. Signing in is optional, and your activity on this device stays
                exactly where it is.
              </p>
              <div className="mt-3 flex gap-2">
                <Link href={`/auth?mode=sign-in&next=${RETURN_TO_SETTINGS}`} className="btn btn-ghost h-12 flex-1">
                  <LogIn className="size-4" />
                  Sign in
                </Link>
                <Link href={`/auth?mode=sign-up&next=${RETURN_TO_SETTINGS}`} className="btn btn-electric h-12 flex-1">
                  <UserPlus className="size-4" />
                  Create account
                </Link>
              </div>
              <SignedOutDataNote />
            </>
          )}

          {status === "signed-in" && account && (
            <>
              <div className="flex items-center gap-3">
                <span className="relative grid size-12 shrink-0 place-items-center">
                  <svg viewBox="0 0 48 48" className="absolute inset-0" aria-hidden="true">
                    <defs>
                      <linearGradient id="account-ring" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#8E7BFF" />
                        <stop offset="1" stopColor="#5FE3FF" />
                      </linearGradient>
                    </defs>
                    <circle cx="24" cy="24" r="22" fill="none" stroke="url(#account-ring)" strokeWidth="1.5" />
                    <circle cx="24" cy="2" r="2.5" fill="var(--ice)" />
                  </svg>
                  <span className="text-sm font-bold text-text-1">{getInitials(account)}</span>
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-1">{account.displayName ?? "TapAct member"}</p>
                  <p className="truncate text-xs text-text-2">{account.email}</p>
                  {account.emailVerified ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[0.68rem] font-medium text-mint">
                      <BadgeCheck className="size-3.5" aria-hidden="true" />
                      Email verified
                    </p>
                  ) : (
                    <p className="mt-1 inline-flex items-center gap-1 text-[0.68rem] font-medium text-ember">
                      <MailWarning className="size-3.5" aria-hidden="true" />
                      Email not verified
                    </p>
                  )}
                </div>
              </div>
              <CloudSyncCard email={account.email} />
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-busy={signingOut}
                className="btn btn-ghost mt-3 h-12 w-full"
              >
                <LogOut className="size-4" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
              <p className="mt-2 text-center text-[0.68rem] text-text-3">
                Signing out keeps all activity on this device. Unsynced changes upload when you sign back in.
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </SectionCard>
  );
}
