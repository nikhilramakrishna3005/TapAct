import { describe, expect, it } from "vitest";
import {
  cursorFromProgress,
  getDayRecap,
  getPlayheadLimit,
  getReplayFrame,
  getReplayMode,
  progressFromCursor,
  shareAreaCaption,
  shareCardLines,
} from "./dayReplay";
import { buildDayTimeline } from "./timeline";
import { type Activity, DEFAULT_ACTIVITIES } from "./tracker";
import type { TimeEntry } from "./sync/merge";

const HOUR = 3_600_000;
const MIN = 60_000;

const activities: Activity[] = [
  { ...DEFAULT_ACTIVITIES[0], category: "work" },
  { ...DEFAULT_ACTIVITIES[1], category: "health", archivedAtMs: 1 },
  { ...DEFAULT_ACTIVITIES[2], category: null },
  { ...DEFAULT_ACTIVITIES[3], category: "learning" },
];

function at(hour: number, minute = 0): number {
  return new Date(2026, 9, 12, hour, minute).getTime();
}

function entry(activityId: string, startMs: number, endMs: number): TimeEntry {
  return { id: `d:${activityId}:${startMs}`, activityId, deviceId: "d", startMs, endMs };
}

function timed(entries: TimeEntry[], extraRecords: Record<string, number> = {}) {
  const records: Record<string, Record<string, number>> = {};
  for (const item of entries) {
    const start = Math.max(item.startMs, new Date(2026, 9, 12).getTime());
    const end = Math.min(item.endMs, new Date(2026, 9, 13).getTime());
    if (end > start) {
      const day = records["2026-10-12"] ?? (records["2026-10-12"] = {});
      day[item.activityId] = (day[item.activityId] ?? 0) + (end - start);
    }
  }
  for (const [id, ms] of Object.entries(extraRecords)) {
    const day = records["2026-10-12"] ?? (records["2026-10-12"] = {});
    day[id] = (day[id] ?? 0) + ms;
  }
  return buildDayTimeline({ dayKey: "2026-10-12", entries, activities, dailyRecords: records, live: null });
}

describe("day replay", () => {
  it("maps progress to the real local day and never invents sessions in gaps", () => {
    const timeline = timed([entry("coding", at(9), at(10, 30)), entry("gym", at(18), at(19))]);
    expect(getReplayMode(timeline)).toBe("timed");
    expect(progressFromCursor(timeline, at(12))).toBeCloseTo(0.5);
    expect(cursorFromProgress(timeline, 0.5)).toBe(at(12));

    const morning = getReplayFrame(timeline, at(9, 45));
    expect(morning.primary?.activity.id).toBe("coding");
    expect(morning.trackedMs).toBe(45 * MIN);
    expect(morning.inGap).toBe(false);

    const gap = getReplayFrame(timeline, at(12));
    expect(gap.primary).toBeNull();
    expect(gap.inGap).toBe(true);
    expect(gap.revealed).toHaveLength(1);
    expect(gap.trackedMs).toBe(90 * MIN);
  });

  it("keeps overlapping and midnight-crossing sessions, including archived activities", () => {
    const entries = [
      entry("coding", at(10), at(12)),
      entry("gym", at(11), at(11, 30)),
      entry("reading", new Date(2026, 9, 11, 23).getTime(), at(1)),
    ];
    const timeline = timed(entries);
    const overlap = getReplayFrame(timeline, at(11, 10));
    expect(overlap.active.map((s) => s.activity.id).sort()).toEqual(["coding", "gym"]);
    expect(overlap.primary?.activity.id).toBe("gym");
    expect(overlap.active.find((s) => s.activity.id === "gym")?.activity.archivedAtMs).toBe(1);

    const afterMidnight = getReplayFrame(timeline, at(0, 30));
    expect(afterMidnight.primary?.activity.id).toBe("reading");
    expect(afterMidnight.primary?.continuesFromPreviousDay).toBe(true);
    expect(afterMidnight.primary?.dayStartMs).toBe(at(0));
  });

  it("caps today at now and treats totals-only days as a static recap", () => {
    const timeline = timed([entry("coding", at(8), at(16))]);
    expect(getPlayheadLimit(timeline, at(10))).toBe(at(10));
    const frame = getReplayFrame(timeline, at(20), at(10));
    expect(frame.cursorMs).toBe(at(10));
    expect(frame.finished).toBe(true);
    expect(frame.trackedMs).toBe(2 * HOUR);

    const totals = buildDayTimeline({
      dayKey: "2026-10-12",
      entries: [],
      activities,
      dailyRecords: { "2026-10-12": { coding: 3 * HOUR, gym: HOUR } },
      live: null,
    });
    expect(getReplayMode(totals)).toBe("totals-only");
    expect(getReplayFrame(totals, at(12)).revealed).toEqual([]);
    expect(getReplayMode(timed([]))).toBe("empty");
  });

  it("builds a recap from recorded time only, with life areas and no activity names on the share card", () => {
    const timeline = timed(
      [entry("coding", at(9), at(11)), entry("gym", at(18), at(18, 40))],
      { communication: HOUR },
    );
    const recap = getDayRecap(timeline);
    expect(recap.sessionMs).toBe(2 * HOUR + 40 * MIN);
    expect(recap.untimedMs).toBe(HOUR);
    expect(recap.totalMs).toBe(3 * HOUR + 40 * MIN);
    expect(recap.activityCount).toBe(3);
    expect(recap.longestMs).toBe(2 * HOUR);
    expect(recap.areas.map((area) => [area.id, area.ms])).toEqual([
      ["work", 2 * HOUR],
      ["health", 40 * MIN],
      ["unassigned", HOUR],
    ]);
    expect(shareCardLines(recap).map((line) => line.label)).toEqual(["Tracked", "Activities", "Longest session"]);
    expect(shareAreaCaption(recap.areas)).toMatch(/Work/);
    expect(shareAreaCaption(recap.areas)).not.toMatch(/Coding|Gym|Communication/i);
  });
});
