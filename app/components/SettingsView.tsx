"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  Info,
  MoreVertical,
  Share,
  Sparkles,
  Smartphone,
  SquarePlus,
  Upload,
  WifiOff,
} from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import packageJson from "@/package.json";
import {
  type BackupSummary,
  createBackup,
  getBackupFileName,
  parseBackup,
  summarizeState,
} from "@/lib/backup";
import { STORAGE_KEY_V3, type TrackerState } from "@/lib/tracker";
import type {
  CommitResult,
  PersistFailureReason,
  TrackerUpdate,
  WritableStorageLike,
} from "@/lib/trackerStore";
import { useMotionPrefs } from "./MotionPrefs";
import { formatSummaryDuration, ScreenHeader, SectionCard, Segmented } from "./ui";

type Feedback = { tone: "success" | "error"; message: string };

type PendingImport = { fileName: string; state: TrackerState; summary: BackupSummary };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Android/i.test(ua)) {
    return "android";
  }
  return "other";
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const BUTTON_CLASS = "btn btn-ghost h-12 flex-1";

export function SettingsView({
  tracker,
  commit,
  getStorage,
  persistFailure,
}: {
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => CommitResult;
  getStorage: () => WritableStorageLike | null;
  persistFailure: PersistFailureReason | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [platform, setPlatform] = useState<Platform>("other");
  const [installed, setInstalled] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [storedBytes, setStoredBytes] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const { prefs, systemReduced, reduced, setPreferences } = useMotionPrefs();
  const [motionSaveFailed, setMotionSaveFailed] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(isStandalone());

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        setOfflineReady(Boolean(registration?.active));
      });
    }

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    const storage = getStorage();
    if (!storage) {
      setStorageAvailable(false);
      return;
    }
    try {
      setStoredBytes(new Blob([storage.getItem(STORAGE_KEY_V3) ?? ""]).size);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [getStorage, tracker]);

  const summary = summarizeState(tracker, null);

  const handleExport = () => {
    try {
      const now = Date.now();
      const backup = createBackup(tracker, now);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getBackupFileName(now);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback({
        tone: "success",
        message: `Backup downloaded: ${summary.activityCount} activities, ${summary.dayCount} recorded days.`,
      });
    } catch {
      setFeedback({ tone: "error", message: "Couldn't create the backup file. Please try again." });
    }
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setPendingImport(null);
    try {
      const result = parseBackup(await file.text(), Date.now());
      if (!result.ok) {
        setFeedback({ tone: "error", message: result.error });
        return;
      }
      setFeedback(null);
      setPendingImport({ fileName: file.name, state: result.state, summary: result.summary });
    } catch {
      setFeedback({ tone: "error", message: "Couldn't read that file." });
    }
  };

  const confirmImport = () => {
    if (!pendingImport) {
      return;
    }
    const imported = pendingImport.state;
    const result = commit((base) => ({ ...imported, revision: base.revision }));
    setPendingImport(null);
    setFeedback(
      result.persisted
        ? {
            tone: "success",
            message: `Restored ${pendingImport.summary.activityCount} activities and ${pendingImport.summary.dayCount} recorded days.`,
          }
        : {
            tone: "error",
            message:
              "Backup loaded for this session, but it couldn't be saved to browser storage on this device.",
          },
    );
  };

  const handleInstall = async () => {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setInstalled(true);
    }
  };

  const storageStatus = !storageAvailable
    ? "Unavailable"
    : persistFailure === "quota"
      ? "Full"
      : persistFailure === "unavailable"
        ? "Write failing"
        : "Healthy";

  return (
    <>
      <ScreenHeader eyebrow="Settings" title="Your data, on your device." />

      <AnimatePresence>
        {feedback && (
          <motion.p
            key={feedback.message}
            role={feedback.tone === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`mt-4 flex items-start gap-2 rounded-2xl border px-3 py-2.5 text-xs leading-relaxed ${
              feedback.tone === "success"
                ? "border-mint/30 bg-mint/[0.07] text-[#C9FBE7]"
                : "border-danger/30 bg-danger/[0.07] text-[#FFD0D0]"
            }`}
          >
            {feedback.tone === "success" ? (
              <CheckCircle2 className="mt-px size-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
            )}
            {feedback.message}
          </motion.p>
        )}
      </AnimatePresence>

      <SectionCard title="Motion" aside={<Sparkles className="size-4 text-text-3" />}>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs text-text-2">Animation intensity</p>
            <Segmented
              label="Animation intensity"
              layoutId="settings-intensity"
              size="md"
              value={prefs.motionIntensity}
              onChange={(motionIntensity) => setMotionSaveFailed(!setPreferences({ motionIntensity }))}
              options={[
                { value: "expressive", label: "Expressive" },
                { value: "subtle", label: "Subtle" },
              ]}
            />
            <p className="mt-2 text-[0.72rem] leading-relaxed text-text-3">
              {prefs.motionIntensity === "expressive"
                ? "Live pulses on running timers, an orbiting logo, and goal celebrations."
                : "Quick transitions only. No looping effects or celebration bursts."}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs text-text-2">Reduced motion</p>
            <Segmented
              label="Reduced motion"
              layoutId="settings-reduced"
              size="md"
              value={prefs.reducedMotion}
              onChange={(reducedMotion) => setMotionSaveFailed(!setPreferences({ reducedMotion }))}
              options={[
                { value: "system", label: "Match device" },
                { value: "reduce", label: "Always reduce" },
              ]}
            />
            <p className="mt-2 text-[0.72rem] leading-relaxed text-text-3">
              {prefs.reducedMotion === "reduce"
                ? "Movement is minimized everywhere, regardless of device settings."
                : systemReduced
                  ? "Your device asks for reduced motion, so movement is minimized."
                  : "Follows your device's reduced-motion setting (currently off)."}
              {reduced && prefs.motionIntensity === "expressive" && " Intensity applies when motion isn't reduced."}
            </p>
          </div>
          {motionSaveFailed && (
            <p role="status" className="text-[0.72rem] text-ember">
              Applied for this session, but browser storage couldn't save it.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Install TapAct" aside={<Smartphone className="size-4 text-text-3" />}>
        {installed ? (
          <p className="flex items-center gap-2 text-sm text-text-2">
            <CheckCircle2 className="size-4 text-mint" />
            Running as an installed app.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-text-2">
              Add TapAct to your home screen for a full-screen app that opens instantly, even offline.
            </p>
            {installPrompt && (
              <button type="button" onClick={handleInstall} className={`${BUTTON_CLASS} w-full`}>
                <SquarePlus className="size-4" />
                Install app
              </button>
            )}
            {(platform === "ios" || platform === "other") && (
              <InstallSteps
                title="iPhone & iPad (Safari)"
                steps={[
                  <>
                    Tap <Share className="inline size-3.5 align-[-2px]" /> <b>Share</b> in the toolbar.
                  </>,
                  <>
                    Choose <b>Add to Home Screen</b>.
                  </>,
                  <>
                    Tap <b>Add</b>, then open TapAct from your home screen.
                  </>,
                ]}
              />
            )}
            {(platform === "android" || platform === "other") && (
              <InstallSteps
                title="Android (Chrome)"
                steps={[
                  <>
                    Tap <MoreVertical className="inline size-3.5 align-[-2px]" /> the browser menu.
                  </>,
                  <>
                    Choose <b>Install app</b> or <b>Add to Home screen</b>.
                  </>,
                  <>Confirm, then launch TapAct from your apps.</>,
                ]}
              />
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Storage" aside={<HardDrive className="size-4 text-text-3" />}>
        <dl className="space-y-2">
          <Row label="Storage mode" value="On this device (local storage)" />
          <Row
            label="Status"
            value={
              <span className={storageStatus === "Healthy" ? "text-mint" : "text-ember"}>
                {storageStatus}
              </span>
            }
          />
          <Row label="Saved data" value={formatBytes(storedBytes)} />
          <Row
            label="Activities"
            value={`${summary.activityCount - summary.archivedCount} active · ${summary.archivedCount} archived`}
          />
          <Row label="Recorded days" value={String(summary.dayCount)} />
          <Row label="Total tracked" value={formatSummaryDuration(summary.totalMs)} />
        </dl>
        <p className="mt-3 text-[0.72rem] leading-relaxed text-text-3">
          No account and no cloud sync. Your records never leave this browser unless you export them.
          Clearing site data removes them, so keep a backup.
        </p>
      </SectionCard>

      <SectionCard title="Backup & restore">
        <div className="flex gap-2">
          <button type="button" onClick={handleExport} className={BUTTON_CLASS}>
            <Download className="size-4" />
            Export data
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={BUTTON_CLASS}
          >
            <Upload className="size-4" />
            Import data
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>
        <p className="mt-2 text-[0.72rem] leading-relaxed text-text-3">
          Backups are JSON files with every activity (including archived ones) and your full history.
        </p>

        <AnimatePresence>
          {pendingImport && (
            <motion.div
              role="alertdialog"
              aria-label="Confirm import"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-[var(--radius-md)] border border-ember/30 bg-ember/[0.05] px-3 py-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-text-1">
                  <AlertTriangle className="size-4 text-ember" />
                  Replace all local data?
                </p>
                <p className="mt-1 truncate text-xs text-text-3">{pendingImport.fileName}</p>
                <dl className="mt-2 space-y-1.5">
                  {pendingImport.summary.exportedAtMs !== null && (
                    <Row label="Exported" value={formatDateTime(pendingImport.summary.exportedAtMs)} />
                  )}
                  <Row
                    label="Activities"
                    value={`${pendingImport.summary.activityCount} (${pendingImport.summary.archivedCount} archived)`}
                  />
                  <Row label="Recorded days" value={String(pendingImport.summary.dayCount)} />
                  <Row
                    label="Total tracked"
                    value={formatSummaryDuration(pendingImport.summary.totalMs)}
                  />
                </dl>
                <p className="mt-2 text-[0.72rem] leading-relaxed text-text-2">
                  Your current {summary.activityCount} activities and {summary.dayCount} recorded days
                  will be replaced, and any running timer will stop. This can&apos;t be undone, so
                  export first if you want to keep them.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    className="btn btn-ghost h-11 flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    className="btn h-11 flex-1 border border-ember/40 bg-ember/[0.14] text-[#FFE1C8]"
                  >
                    Replace data
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SectionCard>

      <SectionCard title="About" aside={<Info className="size-4 text-text-3" />}>
        <dl className="space-y-2">
          <Row label="App" value={`TapAct ${packageJson.version}`} />
          <Row label="Data format" value={`Tracker schema v${tracker.schemaVersion}`} />
          <Row
            label="Offline"
            value={
              <span className="inline-flex items-center gap-1">
                <WifiOff className="size-3.5 text-text-3" />
                {offlineReady ? "Ready" : "Available after first load"}
              </span>
            }
          />
        </dl>
      </SectionCard>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 border-b border-line pb-1.5 last:border-0 last:pb-0">
      <dt className="shrink-0 text-xs text-text-3">{label}</dt>
      <dd className="truncate text-right text-sm font-medium tabular-nums text-text-1">{value}</dd>
    </div>
  );
}

function InstallSteps({ title, steps }: { title: string; steps: React.ReactNode[] }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-3">
      <p className="eyebrow !text-[0.6rem] !tracking-[0.16em]">{title}</p>
      <ol className="mt-2 space-y-1.5">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-2 text-xs leading-relaxed text-text-2">
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-volt/25 text-[0.6rem] font-semibold text-text-1">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
