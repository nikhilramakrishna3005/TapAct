import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDefaultTrackerState,
  getDayKeyForMs,
  getElapsedByActivityForDay,
  toggleActivity,
} from "./tracker";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const originalTz = process.env.TZ;

function useTimeZone(timeZone: string) {
  beforeAll(() => {
    process.env.TZ = timeZone;
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });
}

function trackBetween(startMs: number, endMs: number) {
  const running = toggleActivity(createDefaultTrackerState(startMs), "coding", startMs);
  return toggleActivity(running, "coding", endMs);
}

function codingOn(state: ReturnType<typeof trackBetween>, year: number, month: number, day: number) {
  const dayKey = getDayKeyForMs(new Date(year, month, day, 12).getTime());
  return getElapsedByActivityForDay(state, dayKey).coding;
}

describe("midnight rollover across DST in America/New_York", () => {
  useTimeZone("America/New_York");

  it("uses the expected zone offsets", () => {
    expect(new Date(2026, 2, 7, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 2, 8, 12).getTimezoneOffset()).toBe(240);
  });

  it("credits a 23-hour day when clocks spring forward", () => {
    const start = new Date(2026, 2, 7, 23, 30).getTime();
    const end = new Date(2026, 2, 9, 0, 30).getTime();
    const state = trackBetween(start, end);

    expect(codingOn(state, 2026, 2, 7)).toBe(30 * MINUTE);
    expect(codingOn(state, 2026, 2, 8)).toBe(23 * HOUR);
    expect(codingOn(state, 2026, 2, 9)).toBe(30 * MINUTE);
    expect(30 * MINUTE + 23 * HOUR + 30 * MINUTE).toBe(end - start);
  });

  it("credits a 25-hour day when clocks fall back", () => {
    const start = new Date(2026, 9, 31, 23, 0).getTime();
    const end = new Date(2026, 10, 2, 1, 0).getTime();
    const state = trackBetween(start, end);

    expect(codingOn(state, 2026, 9, 31)).toBe(HOUR);
    expect(codingOn(state, 2026, 10, 1)).toBe(25 * HOUR);
    expect(codingOn(state, 2026, 10, 2)).toBe(HOUR);
    expect(3 * HOUR + 24 * HOUR).toBe(end - start);
  });
});

describe("midnight rollover when DST skips midnight in America/Havana", () => {
  useTimeZone("America/Havana");

  it("starts the new day at 01:00 when 00:00 does not exist", () => {
    expect(new Date(2026, 2, 8, 0, 30).getHours()).toBe(1);

    const start = new Date(2026, 2, 7, 23, 30).getTime();
    const end = new Date(2026, 2, 8, 1, 30).getTime();
    const state = trackBetween(start, end);

    expect(end - start).toBe(HOUR);
    expect(codingOn(state, 2026, 2, 7)).toBe(30 * MINUTE);
    expect(codingOn(state, 2026, 2, 8)).toBe(30 * MINUTE);
  });
});
