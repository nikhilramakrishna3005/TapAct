/** Motion tokens shared by every animated surface. Durations are in seconds (Motion for React). */
export const DURATION = {
  instant: 0.15,
  quick: 0.2,
  base: 0.26,
  slow: 0.35,
} as const;

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const SPRING_SNAPPY = { type: "spring", stiffness: 460, damping: 36 } as const;
export const SPRING_SHEET = { type: "spring", stiffness: 340, damping: 34 } as const;

export const TRANSITION_QUICK = { duration: DURATION.quick, ease: EASE_OUT };
export const TRANSITION_BASE = { duration: DURATION.base, ease: EASE_OUT };
export const TRANSITION_SLOW = { duration: DURATION.slow, ease: EASE_OUT };
