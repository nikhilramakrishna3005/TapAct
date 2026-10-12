import { createBackup, getBackupFileName } from "@/lib/backup";
import type { TrackerState } from "@/lib/tracker";

/** Saves a standard TapAct backup file. Returns false if the browser blocked it. */
export function downloadBackup(tracker: TrackerState, label?: string): boolean {
  try {
    const now = Date.now();
    const backup = createBackup(tracker, now);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = label ? getBackupFileName(now).replace(".json", `-${label}.json`) : getBackupFileName(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
