import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOCK_CHARS,
  DAY_ORBIT,
  DASH_STROKE,
  IDLE_DURATION_CHARS,
  MARKER_CLEARANCE,
  OUTER_STROKE,
  RING_GAP,
  SATELLITE_INWARD,
  idleDurationBox,
  minimumMarkerGap,
  runningClockBox,
  todayContentWidth,
} from "./dayOrbitLayout";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const timerBoxes = [runningClockBox(), idleDurationBox()];

describe("Today orbit marker clearance", () => {
  it("overlaps the session clock when markers stay on the old inner ring", () => {
    const clock = runningClockBox();
    expect(clock.halfWidth).toBeGreaterThan(80);
    expect(minimumMarkerGap(80, clock, SATELLITE_INWARD)).toBeLessThan(0);
    expect(minimumMarkerGap(80, clock, DASH_STROKE / 2)).toBeLessThan(0);
  });

  it("keeps goal dots and dashed ticks off the timer across the ring", () => {
    expect(CLOCK_CHARS).toBe(8);
    expect(IDLE_DURATION_CHARS).toBe(7);
    for (const box of timerBoxes) {
      expect(minimumMarkerGap(DAY_ORBIT.innerR, box, SATELLITE_INWARD)).toBeGreaterThanOrEqual(MARKER_CLEARANCE);
      expect(minimumMarkerGap(DAY_ORBIT.innerR, box, DASH_STROKE / 2)).toBeGreaterThanOrEqual(MARKER_CLEARANCE);
    }
    for (let count = 1; count <= 12; count += 1) {
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        const x = DAY_ORBIT.innerR * Math.cos(angle);
        const y = DAY_ORBIT.innerR * Math.sin(angle);
        for (const box of timerBoxes) {
          const dx = Math.abs(x) > box.halfWidth ? Math.abs(x) - box.halfWidth : 0;
          const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
          expect(Math.hypot(dx, dy) - SATELLITE_INWARD).toBeGreaterThanOrEqual(MARKER_CLEARANCE);
        }
      }
    }
  });

  it("grows the rings without changing their stroke, gap, or the timer type", () => {
    expect(DAY_ORBIT.outerStroke).toBe(OUTER_STROKE);
    expect(DAY_ORBIT.outerR - OUTER_STROKE / 2 - DAY_ORBIT.innerR).toBe(RING_GAP);
    expect(DAY_ORBIT.innerR).toBeGreaterThan(80);
    expect(DAY_ORBIT.size).toBeLessThanOrEqual(todayContentWidth(375));
    expect(DAY_ORBIT.size).toBeLessThanOrEqual(todayContentWidth(390));
    expect(DAY_ORBIT.size).toBeLessThanOrEqual(todayContentWidth(1280));

    const page = source("app/page.tsx");
    expect(page).toContain("text-[2.35rem] font-semibold leading-none");
    expect(page).toContain("text-[2.6rem] font-semibold leading-none");
    expect(page).toContain("formatClock(sessionMs)");

    const orbit = source("app/components/Orbit.tsx");
    expect(orbit).toContain("DAY_ORBIT.innerR");
    expect(orbit).toContain('strokeDasharray="2 6"');
    expect(orbit).toContain("r: satellite.met ? 5 : 3.5");
    expect(orbit).toContain("r={6}");
    expect(orbit).toContain("strokeWidth={OUTER_STROKE}");
  });
});
