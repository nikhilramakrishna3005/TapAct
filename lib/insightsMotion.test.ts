import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DURATION } from "./motion";
import {
  INSIGHTS_BAR_DURATION,
  INSIGHTS_BAR_STAGGER,
  INSIGHTS_CHART_EASE,
  INSIGHTS_RING_DURATION,
  INSIGHTS_RING_EASE,
  INSIGHTS_SHARE_DURATION,
  insightsTransition,
} from "./insightsMotion";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Insights chart motion", () => {
  it("uses longer chart timings without changing the shared duration scale", () => {
    expect(DURATION.slow).toBe(0.35);
    expect(INSIGHTS_BAR_DURATION).toBeGreaterThanOrEqual(0.8);
    expect(INSIGHTS_BAR_DURATION).toBeLessThanOrEqual(0.9);
    expect(INSIGHTS_BAR_STAGGER).toBe(0.05);
    expect(INSIGHTS_RING_DURATION).toBeGreaterThanOrEqual(1);
    expect(INSIGHTS_RING_DURATION).toBeLessThanOrEqual(1.2);
    expect(INSIGHTS_SHARE_DURATION).toBeGreaterThanOrEqual(0.7);
    expect(INSIGHTS_SHARE_DURATION).toBeLessThanOrEqual(0.85);
    expect(INSIGHTS_CHART_EASE[1]).toBeLessThan(1);
    expect(INSIGHTS_RING_EASE[3]).toBe(1);
  });

  it("drops chart motion immediately when reduced motion is on", () => {
    expect(insightsTransition(true, INSIGHTS_BAR_DURATION, INSIGHTS_CHART_EASE, 0.2)).toEqual({
      duration: 0,
      delay: 0,
      ease: INSIGHTS_CHART_EASE,
    });
    expect(insightsTransition(false, INSIGHTS_RING_DURATION, INSIGHTS_RING_EASE)).toMatchObject({
      duration: INSIGHTS_RING_DURATION,
      delay: 0,
      ease: INSIGHTS_RING_EASE,
    });
  });

  it("rises the weekly bars once and keeps the chart layout", () => {
    const view = source("app/components/InsightsView.tsx");
    expect(view).toContain('title="See where your time goes."');
    expect(view).toContain('title="Last 7 days"');
    expect(view).toContain("const CHART_HEIGHT = 148");
    expect(view).toContain("getLastNDays");
    expect(view).toContain("origin-bottom");
    expect(view).toContain("initial={reduced ? false : { scaleY: 0 }}");
    expect(view).toContain("animate={{ scaleY: 1 }}");
    expect(view).toContain("INSIGHTS_BAR_DURATION");
    expect(view).toContain("index * INSIGHTS_BAR_STAGGER");
    expect(view).not.toContain("initial={{ height: 0 }}");
    expect(view).not.toContain("DURATION.slow");
  });

  it("draws the life balance ring and share bars without tying them to live totals", () => {
    const view = source("app/components/LifeBalance.tsx");
    expect(view).toContain("computeLifeBalance");
    expect(view).toContain('title="Life Balance"');
    expect(view).toContain("initial={reduced ? false : { pathLength: 0 }}");
    expect(view).toContain("animate={{ pathLength: 1 }}");
    expect(view).toContain("key={`${period}-${area.id}`}");
    expect(view).toContain("INSIGHTS_RING_DURATION");
    expect(view).toContain("key={period}");
    expect(view).toContain("width: shareWidth");
    expect(view).toContain("initial={reduced ? false : { scaleX: 0 }}");
    expect(view).toContain("animate={{ scaleX: 1 }}");
    expect(view).toContain("INSIGHTS_SHARE_DURATION");
    expect(view).not.toContain("DURATION.slow");
    expect(view).toContain("aria-expanded={expanded}");
  });

  it("keeps the main tab switch immediate", () => {
    const page = source("app/page.tsx");
    const mainStart = page.indexOf("<motion.main");
    const tabStart = page.indexOf("<div key={tab}>", mainStart);
    const shell = page.slice(mainStart, page.indexOf('tab === "insights"', tabStart));
    expect(shell).toContain("<div key={tab}>");
    expect(shell).not.toContain('mode="wait"');
  });
});
