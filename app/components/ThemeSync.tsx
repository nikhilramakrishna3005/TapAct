"use client";

import { useLayoutEffect } from "react";
import { resolveAppearanceChoice, resolveTheme, THEME_COLOR, type ResolvedTheme } from "@/lib/theme";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function applyDocumentTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
}

export function applyStoredAppearance(systemDark: boolean): ResolvedTheme {
  const theme = resolveTheme(resolveAppearanceChoice(browserStorage()), systemDark);
  applyDocumentTheme(theme);
  return theme;
}

export function ThemeSync() {
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyStoredAppearance(media.matches);
    apply();
    const onScheme = () => {
      if (resolveAppearanceChoice(browserStorage()) === "system") apply();
    };
    media.addEventListener("change", onScheme);
    window.addEventListener("storage", apply);
    return () => {
      media.removeEventListener("change", onScheme);
      window.removeEventListener("storage", apply);
    };
  }, []);
  return null;
}
