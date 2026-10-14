"use client";

import { motion } from "motion/react";
import { AlertTriangle, CloudUpload, Download, HardDrive, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { summarizeState } from "@/lib/backup";
import { DURATION, SPRING_SHEET } from "@/lib/motion";
import type { OwnershipDecision, SyncOwner } from "@/lib/sync/state";
import type { TrackerState } from "@/lib/tracker";
import { downloadBackup } from "./downloadBackup";
import { formatSummaryDuration } from "./ui";

export function SyncPrompt({
  decision,
  account,
  tracker,
  busy,
  online,
  errorMessage,
  onMerge,
  onKeepAside,
  onClose,
}: {
  decision: Extract<OwnershipDecision, { kind: "guest-data" | "other-account" }>;
  account: SyncOwner;
  tracker: TrackerState;
  busy: boolean;
  online: boolean;
  errorMessage: string | null;
  onMerge: () => Promise<void>;
  onKeepAside: () => Promise<void>;
  onClose: () => void;
}) {
  const summary = summarizeState(tracker, null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [backupSaved, setBackupSaved] = useState<boolean | null>(null);
  const accountLabel = account.email ?? "your account";
  const isOtherAccount = decision.kind === "other-account";
  const ownerLabel = isOtherAccount ? (decision.ownerEmail ?? "another account") : null;
  const titleId = "sync-prompt-title";

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-[var(--overlay)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.quick }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SPRING_SHEET}
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-[var(--radius-xl)] border border-b-0 border-line-strong bg-ink-1 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-24px_60px_-30px_var(--sheet-shadow)]"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[var(--handle)]" />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Cloud sync</p>
            <h3 id={titleId} className="display mt-2 text-[1.35rem]">
              {isOtherAccount ? "This device holds another account's data" : "Bring this device's data into your account?"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong text-text-2 transition-colors hover:text-text-1"
            aria-label="Decide later"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-2">
          {isOtherAccount ? (
            <>
              The activity on this device belongs to <b className="text-text-1 [overflow-wrap:anywhere]">{ownerLabel}</b>.
              It will never be added to <b className="text-text-1 [overflow-wrap:anywhere]">{accountLabel}</b>.
            </>
          ) : (
            <>
              This device has activity history that isn&apos;t in{" "}
              <b className="text-text-1 [overflow-wrap:anywhere]">{accountLabel}</b> yet. Nothing syncs until you choose.
            </>
          )}
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            ["Activities", String(summary.activityCount)],
            ["Days", String(summary.dayCount)],
            ["Tracked", formatSummaryDuration(summary.totalMs)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-2.5">
              <dt className="eyebrow !text-[0.56rem] !tracking-[0.16em]">{label}</dt>
              <dd className="numeric mt-1 text-base font-semibold text-text-1">{value}</dd>
            </div>
          ))}
        </dl>

        {!isOtherAccount && (
          <button
            type="button"
            onClick={() => setBackupSaved(downloadBackup(tracker, "before-sync"))}
            className="btn btn-ghost mt-3 h-11 w-full text-[0.8rem]"
          >
            <Download className="size-4" />
            {backupSaved ? "Backup downloaded" : "Download a backup first"}
          </button>
        )}
        {backupSaved === false && (
          <p role="alert" className="mt-2 text-xs text-danger">
            Couldn&apos;t create the backup file. Try again from Settings → Backup.
          </p>
        )}

        {!online && (
          <p role="status" className="mt-3 rounded-2xl border border-ice/25 bg-ice/[0.06] px-3 py-2.5 text-xs text-[var(--ice-ink)]">
            You&apos;re offline. Connect to the internet to choose, or decide later. Tracking keeps working.
          </p>
        )}
        {errorMessage && (
          <p role="alert" className="mt-3 rounded-2xl border border-danger/30 bg-danger/[0.07] px-3 py-2.5 text-xs text-[var(--danger-ink)]">
            {errorMessage} Nothing was changed on this device.
          </p>
        )}

        <div className="mt-4 space-y-2.5">
          {!isOtherAccount &&
            (confirmMerge ? (
              <div className="rounded-[var(--radius-md)] border border-ember/30 bg-ember/[0.05] px-3 py-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-text-1">
                  <AlertTriangle className="size-4 text-ember" aria-hidden="true" />
                  Merge into {accountLabel}?
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-text-2">
                  Only merge if this is your data and it isn&apos;t already in this account (for example, a backup of
                  it). Activities the account already has keep the account&apos;s names and goals. Your recorded time is
                  kept either way.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setConfirmMerge(false)} className="btn btn-ghost h-11 flex-1">
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={busy || !online}
                    aria-busy={busy}
                    onClick={() => void onMerge()}
                    className="btn btn-electric h-11 flex-1"
                  >
                    {busy ? "Merging…" : "Merge"}
                  </button>
                </div>
              </div>
            ) : (
              <OptionButton
                icon={<CloudUpload className="size-4" />}
                title="Merge into my account"
                body={`Adds this history to ${accountLabel} and keeps it synced across your devices.`}
                onClick={() => setConfirmMerge(true)}
                disabled={busy || !online}
                primary
              />
            ))}
          <OptionButton
            icon={isOtherAccount ? <ShieldCheck className="size-4" /> : <HardDrive className="size-4" />}
            title={isOtherAccount ? `Switch this device to ${accountLabel}` : "Keep it on this device only"}
            body={
              isOtherAccount
                ? `${ownerLabel}'s data stays saved on this device, untouched, and syncs again when they sign in.`
                : `Sets this data aside on this device and shows ${accountLabel}'s synced data. Nothing is uploaded or deleted.`
            }
            onClick={() => void onKeepAside()}
            disabled={busy || !online}
            primary={isOtherAccount}
          />
          <button type="button" onClick={onClose} className="btn btn-ghost h-12 w-full">
            Decide later
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}

function OptionButton({
  icon,
  title,
  body,
  onClick,
  disabled,
  primary = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-colors disabled:opacity-50 ${
        primary ? "border-volt/45 bg-volt/[0.09] hover:border-volt/70" : "border-line-strong bg-ink-0 hover:border-line-strong"
      }`}
    >
      <span
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
          primary ? "bg-[linear-gradient(135deg,var(--volt),var(--ice))] text-ink-0" : "border border-line-strong text-text-2"
        }`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-text-1">{title}</span>
        <span className="mt-0.5 block text-[0.74rem] leading-relaxed text-text-3">{body}</span>
      </span>
    </button>
  );
}
