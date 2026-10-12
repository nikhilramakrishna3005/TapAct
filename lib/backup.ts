import {
  loadTrackerState,
  processActiveTimer,
  STORAGE_KEY_V3,
  type TrackerState,
} from "./tracker";

export const BACKUP_KIND = "tapact-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export type TapActBackup = {
  kind: typeof BACKUP_KIND;
  backupVersion: typeof BACKUP_VERSION;
  exportedAtMs: number;
  tracker: TrackerState;
};

export type BackupSummary = {
  exportedAtMs: number | null;
  activityCount: number;
  archivedCount: number;
  dayCount: number;
  totalMs: number;
};

export type ParseBackupResult =
  | { ok: true; state: TrackerState; summary: BackupSummary }
  | { ok: false; error: string };

/** Settles any running timer so the backup holds every second tracked up to export. */
export function createBackup(state: TrackerState, nowMs: number): TapActBackup {
  return {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    exportedAtMs: nowMs,
    tracker: processActiveTimer(state, nowMs),
  };
}

export function getBackupFileName(nowMs: number): string {
  const date = new Date(nowMs);
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return `tapact-backup-${stamp}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function summarizeState(state: TrackerState, exportedAtMs: number | null): BackupSummary {
  let totalMs = 0;
  for (const day of Object.values(state.dailyRecords)) {
    for (const ms of Object.values(day)) {
      totalMs += ms;
    }
  }
  return {
    exportedAtMs,
    activityCount: state.activities.length,
    archivedCount: state.activities.filter((activity) => activity.archivedAtMs !== null).length,
    dayCount: Object.keys(state.dailyRecords).length,
    totalMs,
  };
}

/**
 * Accepts a TapAct backup file (or a raw v3 tracker snapshot) and returns a
 * normalized state. The imported timer is always stopped: resuming it would
 * credit the whole gap between export and import as tracked time.
 */
export function parseBackup(raw: string, nowMs: number): ParseBackupResult {
  if (raw.length > MAX_BACKUP_BYTES) {
    return { ok: false, error: "This file is too large to be a TapAct backup." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "This file isn't a TapAct backup." };
  }

  let tracker: unknown = parsed;
  let exportedAtMs: number | null = null;
  if (parsed.kind === BACKUP_KIND) {
    if (parsed.backupVersion !== BACKUP_VERSION) {
      return { ok: false, error: "This backup was made by an unsupported TapAct version." };
    }
    tracker = parsed.tracker;
    exportedAtMs =
      typeof parsed.exportedAtMs === "number" && Number.isFinite(parsed.exportedAtMs)
        ? parsed.exportedAtMs
        : null;
  }

  if (!isRecord(tracker) || tracker.schemaVersion !== 3) {
    return { ok: false, error: "This file isn't a TapAct backup." };
  }

  const activities = tracker.activities;
  if (
    !Array.isArray(activities) ||
    activities.length === 0 ||
    !activities.every(
      (activity) =>
        isRecord(activity) &&
        typeof activity.id === "string" &&
        activity.id.trim().length > 0 &&
        typeof activity.name === "string" &&
        activity.name.trim().length > 0,
    )
  ) {
    return { ok: false, error: "The backup's activity list is missing or damaged." };
  }

  if (!isRecord(tracker.dailyRecords)) {
    return { ok: false, error: "The backup's history records are missing or damaged." };
  }

  const stopped = {
    ...tracker,
    activeActivityId: null,
    activeSinceMs: null,
    lastProcessedMs: null,
  };
  const serialized = JSON.stringify(stopped);
  const state = loadTrackerState(
    { getItem: (key) => (key === STORAGE_KEY_V3 ? serialized : null) },
    nowMs,
  );

  return { ok: true, state, summary: summarizeState(state, exportedAtMs) };
}
