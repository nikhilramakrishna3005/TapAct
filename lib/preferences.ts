import { LEGACY_STORAGE_KEY, STORAGE_KEY_V2, STORAGE_KEY_V3, type StorageLike } from "./tracker";

/** UI preferences live apart from the tracker so the v3 tracker schema stays untouched. */
export const PREFS_STORAGE_KEY = "tapact.prefs.v1";

export type MotionIntensity = "expressive" | "subtle";
export type ReducedMotionPreference = "system" | "reduce";

export type Preferences = {
  onboardingCompletedAtMs: number | null;
  motionIntensity: MotionIntensity;
  reducedMotion: ReducedMotionPreference;
};

export const DEFAULT_PREFERENCES: Preferences = {
  onboardingCompletedAtMs: null,
  motionIntensity: "expressive",
  reducedMotion: "system",
};

type PrefsStorage = StorageLike & { setItem: (key: string, value: string) => void };

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) {
    return { ...DEFAULT_PREFERENCES };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_PREFERENCES };
  }
  const candidate = value as Record<string, unknown>;
  const completed = candidate.onboardingCompletedAtMs;
  return {
    onboardingCompletedAtMs:
      typeof completed === "number" && Number.isFinite(completed) && completed >= 0 ? completed : null,
    motionIntensity: candidate.motionIntensity === "subtle" ? "subtle" : "expressive",
    reducedMotion: candidate.reducedMotion === "reduce" ? "reduce" : "system",
  };
}

export function loadPreferences(storage: StorageLike | null): Preferences {
  if (!storage) {
    return { ...DEFAULT_PREFERENCES };
  }
  try {
    return parsePreferences(storage.getItem(PREFS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Read-modify-write so concurrent tabs don't drop each other's preference changes. */
export function updatePreferences(
  storage: PrefsStorage | null,
  patch: Partial<Preferences>,
): { prefs: Preferences; persisted: boolean } {
  const prefs = { ...loadPreferences(storage), ...patch };
  if (!storage) {
    return { prefs, persisted: false };
  }
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    return { prefs, persisted: true };
  } catch {
    return { prefs, persisted: false };
  }
}

export function hasStoredTrackerData(storage: StorageLike): boolean {
  return [STORAGE_KEY_V3, STORAGE_KEY_V2, LEGACY_STORAGE_KEY].some((key) => storage.getItem(key) !== null);
}

/**
 * First launch only: people who already have tracker data (from before onboarding
 * existed) or who finished/skipped onboarding go straight to the dashboard. Without
 * readable storage the completion flag can't be saved, so onboarding is not shown.
 */
export function shouldShowOnboarding(storage: StorageLike | null): boolean {
  if (!storage) {
    return false;
  }
  try {
    return loadPreferences(storage).onboardingCompletedAtMs === null && !hasStoredTrackerData(storage);
  } catch {
    return false;
  }
}

export function resolveReducedMotion(pref: ReducedMotionPreference, systemPrefersReduced: boolean): boolean {
  return pref === "reduce" || systemPrefersReduced;
}
