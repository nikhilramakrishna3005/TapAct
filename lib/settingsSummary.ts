import type { AppearanceChoice } from "./theme";

export function appearanceSummary(choice: AppearanceChoice): string {
  if (choice === "light") return "Light";
  if (choice === "dark") return "Dark";
  return "System";
}

export function motionSummary(intensity: "expressive" | "subtle"): string {
  return intensity === "subtle" ? "Subtle" : "Expressive";
}

export function installSummary(installed: boolean): string {
  return installed ? "Installed" : "Add TapAct to your device";
}

export function dataBackupSummary(storageStatus: string, cloudBacked: boolean): string {
  if (storageStatus !== "Healthy") return storageStatus;
  return cloudBacked ? "On this device, synced to your account" : "On this device";
}

export function aboutSummary(version: string): string {
  return `TapAct ${version}`;
}

/** Compact status line for the Notifications section. */
export function notificationStatusSummary(title: string): string {
  if (title === "Notifications enabled on this device") return "Enabled on this device";
  if (title === "Notifications paused") return "Paused";
  if (title === "Push unavailable on this browser") return "Unavailable";
  return title;
}
