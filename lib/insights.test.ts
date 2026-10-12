import { describe, expect, it } from "vitest";
import {
  getBreakdown,
  getDayKeysInRange,
  getGoalMetrics,
  getLastNDays,
  getMonthStartKey,
  getRecordedDayKeys,
  getWeekStartKey,
  sumRange,
} from "./insights";
import { DEFAULT_ACTIVITIES, MS_PER_MINUTE, type Activity, type DailyRecords } from "./tracker";

const archived: Activity = { ...DEFAULT_ACTIVITIES[3], id: "old", archivedAtMs: 1 };
const activities = [...DEFAULT_ACTIVITIES, archived];

const records: DailyRecords = {
  "2026-10-05": { coding: 140 * MS_PER_MINUTE, old: 30 * MS_PER_MINUTE },
  "2026-10-11": { gym: 50 * MS_PER_MINUTE },
  "2026-10-12": { coding: 60 * MS_PER_MINUTE, gym: 60 * MS_PER_MINUTE },
  "2026-09-30": { reading: 10 * MS_PER_MINUTE },
};

describe("insights", () => {
  it("computes week and month boundaries", () => {
    expect(getWeekStartKey("2026-10-12")).toBe("2026-10-12");
    expect(getWeekStartKey("2026-10-11")).toBe("2026-10-05");
    expect(getMonthStartKey("2026-10-12")).toBe("2026-10-01");
    expect(getDayKeysInRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("sums ranges and builds breakdowns including archived activities", () => {
    expect(sumRange(records, "2026-10-01", "2026-10-12")).toBe(340 * MS_PER_MINUTE);
    const breakdown = getBreakdown(records, activities, "2026-10-05", "2026-10-05");
    expect(breakdown.map((entry) => entry.activity.id)).toEqual(["coding", "old"]);
    expect(breakdown[1].share).toBeCloseTo(30 / 170);
  });

  it("builds a 7-day series ending today", () => {
    const bars = getLastNDays(records, activities, "2026-10-12", 7);
    expect(bars).toHaveLength(7);
    expect(bars[0].dayKey).toBe("2026-10-06");
    expect(bars[6].totalMs).toBe(120 * MS_PER_MINUTE);
  });

  it("computes goal metrics from active goals", () => {
    const metrics = getGoalMetrics(records, activities, "2026-10-12");
    expect(metrics.todayMet).toBe(1);
    expect(metrics.todayTotal).toBe(4);
    expect(metrics.weekHits).toBe(2);
    expect(metrics.weekPossible).toBe(28);
    expect(metrics.perfectStreak).toBe(0);
  });

  it("lists recorded days newest first without mutating records", () => {
    const snapshot = JSON.stringify(records);
    expect(getRecordedDayKeys(records)[0]).toBe("2026-10-12");
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});
