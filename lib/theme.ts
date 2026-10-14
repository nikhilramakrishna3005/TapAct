export const APPEARANCE_KEY = "tapact.appearance.v1";

export const RETURNING_STORAGE_KEYS = [
  "tapact.tracker.v3",
  "tapact.tracker.v2",
  "tapact.tracker.v1",
  "tapact.prefs.v1",
] as const;

export type AppearanceChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#F8F9FD",
  dark: "#07070b",
};

type StorageReader = { getItem: (key: string) => string | null };
type StorageWriter = StorageReader & { setItem: (key: string, value: string) => void };

export function parseAppearance(raw: string | null): AppearanceChoice | null {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return null;
}

export function hasReturningData(storage: StorageReader | null): boolean {
  if (!storage) return true;
  try {
    return RETURNING_STORAGE_KEYS.some((key) => storage.getItem(key) !== null);
  } catch {
    return true;
  }
}

/** Saved choice wins. Returning installs stay dark. A blank device follows the system. */
export function resolveAppearanceChoice(storage: StorageReader | null): AppearanceChoice {
  if (!storage) return "dark";
  try {
    const saved = parseAppearance(storage.getItem(APPEARANCE_KEY));
    if (saved) return saved;
    return hasReturningData(storage) ? "dark" : "system";
  } catch {
    return "dark";
  }
}

export function resolveTheme(choice: AppearanceChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "system") return systemDark ? "dark" : "light";
  return choice;
}

export function saveAppearance(storage: StorageWriter | null, choice: AppearanceChoice): boolean {
  if (!storage) return false;
  try {
    storage.setItem(APPEARANCE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

export const THEME_BOOT_SCRIPT = `(function(){var theme="dark",choice="dark";try{var saved=localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)});if(saved==="light"||saved==="dark"||saved==="system"){choice=saved;}else{var returning=${RETURNING_STORAGE_KEYS.map((key) => `localStorage.getItem(${JSON.stringify(key)})`).join("||")};if(returning){choice="dark";}else{choice="system";localStorage.setItem(${JSON.stringify(APPEARANCE_KEY)},"system");}}var systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;theme=choice==="system"?(systemDark?"dark":"light"):choice;}catch(e){}var root=document.documentElement;root.setAttribute("data-theme",theme);root.style.colorScheme=theme;var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",theme==="light"?"${THEME_COLOR.light}":"${THEME_COLOR.dark}");})();`;
