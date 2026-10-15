/**
 * Motion for Insights charts only. Shared DURATION tokens stay unchanged.
 * Durations are seconds, matching Motion for React.
 */

/** Ease-out that accelerates instead of starting at full speed. */
export const INSIGHTS_CHART_EASE = [0.16, 0.72, 0.24, 1] as const;

/** Ease-in-out so a ring draw starts and finishes without a hard stop. */
export const INSIGHTS_RING_EASE = [0.42, 0.02, 0.18, 1] as const;

export const INSIGHTS_BAR_DURATION = 0.85;
export const INSIGHTS_BAR_STAGGER = 0.05;
export const INSIGHTS_RING_DURATION = 1.1;
export const INSIGHTS_SHARE_DURATION = 0.78;

export function insightsTransition(
  reduced: boolean,
  duration: number,
  ease: readonly [number, number, number, number] = INSIGHTS_CHART_EASE,
  delay = 0,
) {
  return {
    duration: reduced ? 0 : duration,
    delay: reduced ? 0 : delay,
    ease,
  };
}
