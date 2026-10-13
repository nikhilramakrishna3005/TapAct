import { describe, expect, it } from "vitest";
import { computeLifeBalance, getObservations, getPeriodRange } from "./lifeBalance";
import { type Activity, DEFAULT_ACTIVITIES, loadTrackerState, MS_PER_MINUTE, STORAGE_KEY_V3 } from "./tracker";

const H = 60 * MS_PER_MINUTE;
const activities: Activity[] = [
  { ...DEFAULT_ACTIVITIES[0], category: "work" },
  { ...DEFAULT_ACTIVITIES[1], category: "health", archivedAtMs: 1 },
  { ...DEFAULT_ACTIVITIES[2], category: null },
  { ...DEFAULT_ACTIVITIES[3], category: "learning" },
];

describe("life balance", () => {
  it("splits tracked time by area, keeps unassigned and archived activities, and compares periods", () => {
    const records = {
      "2026-10-12": { coding: 2 * H, gym: H, communication: H },
      "2026-10-06": { coding: 3 * H },
      "2026-10-05": { reading: H },
    };
    const balance = computeLifeBalance(records, activities, "2026-10-12", "7d");
    const area = (id: string) => balance.areas.find((item) => item.id === id)!;

    expect(balance.range).toMatchObject({ startKey: "2026-10-06", previousStartKey: "2026-09-29", previousEndKey: "2026-10-05" });
    expect(balance.totalMs).toBe(7 * H);
    expect(area("work").ms).toBe(5 * H);
    expect(area("health").activities[0].activity.archivedAtMs).toBe(1);
    expect(area("unassigned").ms).toBe(H);
    expect(area("learning")).toMatchObject({ ms: 0, previousMs: H });
    expect(area("rest").ms).toBe(0);
    expect(balance.areas.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1);
    expect(balance.trackedDays).toBe(2);
  });

  it("never counts untracked time, including as Rest", () => {
    const balance = computeLifeBalance({ "2026-10-12": { coding: H } }, activities, "2026-10-12", "today");
    expect(balance.totalMs).toBe(H);
    expect(balance.areas.find((item) => item.id === "rest")!.ms).toBe(0);
    expect(balance.areas.find((item) => item.id === "work")!.share).toBe(1);
  });

  it("writes neutral observations from recorded data only", () => {
    const records = { "2026-10-12": { coding: 2 * H, communication: H }, "2026-10-11": { coding: 30 * MS_PER_MINUTE } };
    const notes = getObservations(computeLifeBalance(records, activities, "2026-10-12", "today"));
    expect(notes[0]).toBe("Work made up 67% of your tracked time today.");
    expect(notes).toContain("Work time was up 1h 30m compared with yesterday.");
    expect(notes).toContain("1 activity with 1h isn't assigned to a life area yet.");
    expect(getObservations(computeLifeBalance({}, activities, "2026-10-12", "30d"))).toEqual([]);
  });

  it("uses equal-length preceding periods", () => {
    expect(getPeriodRange("2026-10-12", "today")).toMatchObject({ startKey: "2026-10-12", previousStartKey: "2026-10-11" });
    expect(getPeriodRange("2026-10-30", "30d")).toMatchObject({ startKey: "2026-10-01", previousEndKey: "2026-09-30", previousStartKey: "2026-09-01" });
  });

  it("upgrades stored activities without a category to Unassigned and keeps valid ones", () => {
    const stored = {
      schemaVersion: 3,
      revision: 4,
      activeActivityId: null,
      activeSinceMs: null,
      lastProcessedMs: null,
      activities: [
        { id: "coding", name: "Coding", iconKey: "brain", color: "#8B95FF", goalMinutes: 60, cue: "x", archivedAtMs: null },
        { id: "gym", name: "Gym", iconKey: "dumbbell", color: "#4FD1A5", goalMinutes: null, cue: "x", archivedAtMs: null, category: "health" },
        { id: "nap", name: "Nap", iconKey: "heart", color: "#4FD1A5", goalMinutes: null, cue: "x", archivedAtMs: null, category: "sleep" },
      ],
      dailyRecords: { "2026-10-12": { coding: H } },
    };
    const state = loadTrackerState({ getItem: (key) => (key === STORAGE_KEY_V3 ? JSON.stringify(stored) : null) }, 0);
    expect(state.activities.map((activity) => activity.category)).toEqual([null, "health", null]);
    expect(state.dailyRecords["2026-10-12"].coding).toBe(H);
  });
});
