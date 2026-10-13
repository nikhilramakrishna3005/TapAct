import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeDailyRecords, type TimeEntry } from "./sync/merge";
import { buildDayTimeline, getDayBounds, getHourMarks } from "./timeline";
import { type Activity, DEFAULT_ACTIVITIES } from "./tracker";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const archived: Activity = { ...DEFAULT_ACTIVITIES[1], archivedAtMs: 1 };
const activities: Activity[] = [DEFAULT_ACTIVITIES[0], archived];

function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

function entry(activityId: string, startMs: number, endMs: number, deviceId = "a"): TimeEntry {
  return { id: `${deviceId}:${activityId}:${startMs}`, activityId, deviceId, startMs, endMs };
}

describe("buildDayTimeline", () => {
  it("places recorded sessions at their real times, including archived activities", () => {
    const entries = [entry("coding", at(12, 9), at(12, 10, 30)), entry("gym", at(12, 18), at(12, 19))];
    const timeline = buildDayTimeline({
      dayKey: "2026-10-12",
      entries,
      activities,
      dailyRecords: computeDailyRecords({ entries, baselines: [] }),
      live: null,
    });
    expect(timeline.sessions.map((s) => [s.activity.id, s.dayStartMs, s.dayEndMs])).toEqual([
      ["coding", at(12, 9), at(12, 10, 30)],
      ["gym", at(12, 18), at(12, 19)],
    ]);
    expect(timeline.sessions[1].activity.archivedAtMs).toBe(1);
    expect(timeline.untimed).toEqual([]);
    expect(timeline.laneCount).toBe(1);
  });

  it("splits a session that crosses midnight into each day's portion", () => {
    const entries = [entry("coding", at(11, 23), at(12, 1, 30))];
    const input = { entries, activities, dailyRecords: computeDailyRecords({ entries, baselines: [] }), live: null };
    const before = buildDayTimeline({ ...input, dayKey: "2026-10-11" }).sessions[0];
    const after = buildDayTimeline({ ...input, dayKey: "2026-10-12" }).sessions[0];
    expect(before.dayEndMs - before.dayStartMs).toBe(HOUR);
    expect(before.continuesIntoNextDay).toBe(true);
    expect(after.dayEndMs - after.dayStartMs).toBe(90 * MINUTE);
    expect(after.continuesFromPreviousDay).toBe(true);
    expect(after.startMs).toBe(at(11, 23));
  });

  it("reports totals without session times as untimed instead of inventing them", () => {
    const entries = [entry("coding", at(12, 9), at(12, 10))];
    const dailyRecords = { "2026-10-12": { coding: 3 * HOUR, gym: 45 * MINUTE } };
    const timeline = buildDayTimeline({ dayKey: "2026-10-12", entries, activities, dailyRecords, live: null });
    expect(timeline.sessions).toHaveLength(1);
    expect(timeline.untimed.map((u) => [u.activity.id, u.ms])).toEqual([
      ["coding", 2 * HOUR],
      ["gym", 45 * MINUTE],
    ]);
  });

  it("shows overlapping same-activity segments once and stacks different activities", () => {
    const entries = [
      entry("coding", at(12, 9), at(12, 11), "a"),
      entry("coding", at(12, 10), at(12, 12), "b"),
      entry("gym", at(12, 10, 30), at(12, 11), "b"),
    ];
    const timeline = buildDayTimeline({
      dayKey: "2026-10-12",
      entries,
      activities,
      dailyRecords: computeDailyRecords({ entries, baselines: [] }),
      live: null,
    });
    expect(timeline.sessions.map((s) => [s.activity.id, s.lane])).toEqual([
      ["coding", 0],
      ["gym", 1],
    ]);
    expect(timeline.sessions[0].dayEndMs - timeline.sessions[0].dayStartMs).toBe(3 * HOUR);
    expect(timeline.laneCount).toBe(2);
    expect(timeline.untimed).toEqual([]);
  });

  it("marks the running session as live", () => {
    const live = entry("coding", at(12, 14), at(12, 14, 20));
    const timeline = buildDayTimeline({
      dayKey: "2026-10-12",
      entries: [],
      activities,
      dailyRecords: { "2026-10-12": { coding: 20 * MINUTE } },
      live,
    });
    expect(timeline.sessions[0].live).toBe(true);
    expect(timeline.untimed).toEqual([]);
  });

  it("hides deleted entries, flags manual ones, and lists the entries behind each session", () => {
    const entries: TimeEntry[] = [
      { ...entry("coding", at(12, 9), at(12, 10)), deletedAtMs: 5 },
      { ...entry("coding", at(12, 11), at(12, 12)), source: "manual" },
      entry("coding", at(12, 12), at(12, 13)),
    ];
    const timeline = buildDayTimeline({
      dayKey: "2026-10-12",
      entries,
      activities,
      dailyRecords: computeDailyRecords({ entries, baselines: [] }),
      live: null,
    });
    expect(timeline.sessions).toHaveLength(1);
    expect(timeline.sessions[0]).toMatchObject({ manual: true, dayStartMs: at(12, 11), dayEndMs: at(12, 13) });
    expect(timeline.sessions[0].entryIds).toEqual([entries[1].id, entries[2].id].sort());
    expect(timeline.untimed).toEqual([]);
  });

  it("skips segments of activities the tracker doesn't know", () => {
    const timeline = buildDayTimeline({
      dayKey: "2026-10-12",
      entries: [entry("deleted", at(12, 9), at(12, 10))],
      activities,
      dailyRecords: {},
      live: null,
    });
    expect(timeline.sessions).toEqual([]);
  });
});

describe("day bounds", () => {
  it("uses real local day lengths on DST change days", () => {
    const fallBack = getDayBounds("2026-11-01");
    expect(fallBack.endMs - fallBack.startMs).toBe(25 * HOUR);
    const marks = getHourMarks("2026-11-01");
    expect(marks[0].ratio).toBe(0);
    expect(marks[24].ratio).toBe(1);
    expect(marks[12].ms).toBe(new Date(2026, 10, 1, 12).getTime());
  });
});
