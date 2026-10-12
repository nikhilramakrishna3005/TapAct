import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  parsePreferences,
  PREFS_STORAGE_KEY,
  resolveReducedMotion,
  shouldShowOnboarding,
  updatePreferences,
} from "./preferences";
import { LEGACY_STORAGE_KEY, STORAGE_KEY_V3 } from "./tracker";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("preferences", () => {
  it("falls back to defaults for missing or malformed values", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
    expect(
      parsePreferences(JSON.stringify({ motionIntensity: "wild", reducedMotion: 3, onboardingCompletedAtMs: -1 })),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it("merges updates on top of the stored value", () => {
    const storage = memoryStorage();
    updatePreferences(storage, { motionIntensity: "subtle" });
    const { prefs, persisted } = updatePreferences(storage, { onboardingCompletedAtMs: 42 });
    expect(persisted).toBe(true);
    expect(prefs).toEqual({ onboardingCompletedAtMs: 42, motionIntensity: "subtle", reducedMotion: "system" });
    expect(loadPreferences(storage)).toEqual(prefs);
  });

  it("reports unsaved updates when storage throws", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(updatePreferences(storage, { reducedMotion: "reduce" }).persisted).toBe(false);
  });

  it("shows onboarding only on a true first launch", () => {
    expect(shouldShowOnboarding(memoryStorage())).toBe(true);
    expect(shouldShowOnboarding(null)).toBe(false);
    expect(shouldShowOnboarding(memoryStorage({ [STORAGE_KEY_V3]: "{}" }))).toBe(false);
    expect(shouldShowOnboarding(memoryStorage({ [LEGACY_STORAGE_KEY]: "{}" }))).toBe(false);
    expect(
      shouldShowOnboarding(
        memoryStorage({ [PREFS_STORAGE_KEY]: JSON.stringify({ onboardingCompletedAtMs: 1 }) }),
      ),
    ).toBe(false);
  });

  it("reduces motion when either the user or the system asks", () => {
    expect(resolveReducedMotion("system", false)).toBe(false);
    expect(resolveReducedMotion("system", true)).toBe(true);
    expect(resolveReducedMotion("reduce", false)).toBe(true);
  });
});
