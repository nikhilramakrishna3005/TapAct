"use client";

import { MotionConfig } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  type Preferences,
  resolveReducedMotion,
  updatePreferences,
} from "@/lib/preferences";

type PrefsStorage = Storage | null;

function getPrefsStorage(): PrefsStorage {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type MotionPrefsValue = {
  prefs: Preferences;
  loaded: boolean;
  systemReduced: boolean;
  /** True when animation should be minimized (user choice or OS setting). */
  reduced: boolean;
  /** True when ambient loops and celebratory flourishes should play. */
  expressive: boolean;
  setPreferences: (patch: Partial<Preferences>) => boolean;
};

const MotionPrefsContext = createContext<MotionPrefsValue | null>(null);

export function MotionPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    setPrefs(loadPreferences(getPrefsStorage()));
    setLoaded(true);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(query.matches);
    const handleChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    query.addEventListener("change", handleChange);
    const handleStorage = () => setPrefs(loadPreferences(getPrefsStorage()));
    window.addEventListener("storage", handleStorage);
    return () => {
      query.removeEventListener("change", handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const reduced = resolveReducedMotion(prefs.reducedMotion, systemReduced);
  const expressive = !reduced && prefs.motionIntensity === "expressive";

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : prefs.motionIntensity;
  }, [prefs.motionIntensity, reduced]);

  const setPreferences = useCallback((patch: Partial<Preferences>) => {
    const result = updatePreferences(getPrefsStorage(), patch);
    setPrefs(result.prefs);
    return result.persisted;
  }, []);

  const value = useMemo(
    () => ({ prefs, loaded, systemReduced, reduced, expressive, setPreferences }),
    [expressive, loaded, prefs, reduced, setPreferences, systemReduced],
  );

  return (
    <MotionPrefsContext.Provider value={value}>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>
    </MotionPrefsContext.Provider>
  );
}

export function useMotionPrefs(): MotionPrefsValue {
  const value = useContext(MotionPrefsContext);
  if (!value) {
    throw new Error("useMotionPrefs must be used inside MotionPrefsProvider");
  }
  return value;
}
