import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PREFS_STORAGE_KEY, updatePreferences } from "./preferences";
import { STORAGE_KEY_V3 } from "./tracker";
import {
  APPEARANCE_KEY,
  hasReturningData,
  resolveAppearanceChoice,
  resolveTheme,
  saveAppearance,
  THEME_BOOT_SCRIPT,
} from "./theme";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function channel(hex: string, index: number): number {
  const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: string, background: string): number {
  const lum = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  const left = lum(foreground);
  const right = lum(background);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

describe("appearance preference", () => {
  it("keeps a saved choice and follows the system only when asked", () => {
    const storage = memory({ [APPEARANCE_KEY]: "light" });
    expect(resolveAppearanceChoice(storage)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("leaves returning users on dark until they choose, and fresh installs on system", () => {
    expect(resolveAppearanceChoice(memory({ [STORAGE_KEY_V3]: "{}" }))).toBe("dark");
    expect(resolveAppearanceChoice(memory({ [PREFS_STORAGE_KEY]: "{}" }))).toBe("dark");
    expect(hasReturningData(memory())).toBe(false);
    expect(resolveAppearanceChoice(memory())).toBe("system");
    expect(resolveAppearanceChoice(null)).toBe("dark");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(resolveAppearanceChoice(blocked)).toBe("dark");
  });

  it("saves appearance without touching tracker data or motion preferences", () => {
    const storage = memory({
      [STORAGE_KEY_V3]: "{\"activities\":[1]}",
      [PREFS_STORAGE_KEY]: JSON.stringify({ motionIntensity: "subtle", reducedMotion: "reduce", onboardingCompletedAtMs: 5 }),
    });
    expect(saveAppearance(storage, "light")).toBe(true);
    expect(storage.getItem(APPEARANCE_KEY)).toBe("light");
    expect(storage.getItem(STORAGE_KEY_V3)).toBe("{\"activities\":[1]}");
    expect(JSON.parse(storage.getItem(PREFS_STORAGE_KEY) ?? "{}")).toMatchObject({
      motionIntensity: "subtle",
      reducedMotion: "reduce",
    });
    updatePreferences(storage, { motionIntensity: "expressive" });
    expect(storage.getItem(APPEARANCE_KEY)).toBe("light");
    expect(saveAppearance({ getItem: () => null, setItem: () => { throw new Error("blocked"); } }, "dark")).toBe(false);
  });

  it("boots from the same storage key before paint", () => {
    expect(THEME_BOOT_SCRIPT).toContain(APPEARANCE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain("tapact.tracker.v3");
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_BOOT_SCRIPT).toContain('setAttribute("data-theme"');
    expect(THEME_BOOT_SCRIPT).toContain("colorScheme");
    expect(THEME_BOOT_SCRIPT).toContain(`localStorage.setItem(${JSON.stringify(APPEARANCE_KEY)},"system")`);
    expect(THEME_BOOT_SCRIPT.indexOf("setItem")).toBeGreaterThan(THEME_BOOT_SCRIPT.indexOf("returning"));
  });
});

describe("light theme contrast", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const light = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf("/* end light theme */"));

  function token(name: string): string {
    const match = light.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!match) throw new Error(`missing ${name}`);
    return match[1];
  }

  it("keeps readable text and accents on the light background", () => {
    const background = token("--background");
    expect(background.toLowerCase()).toBe("#f8f9fd");
    expect(contrast(token("--text-1"), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--text-2"), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--text-3"), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--volt-hi"), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--ice"), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--mint"), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--danger"), background)).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain("--ink-0: #07070b");
    expect(css).toContain("--volt: #8e7bff");
  });
});
