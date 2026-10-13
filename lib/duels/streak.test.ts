import { describe, expect, it } from "vitest";
import { summarizeShowcase, type ShowcaseBattle } from "./showcase";
import { consistencyStreak, dayPhase, longestConsistencyStreak } from "./streak";

const days = [
  { dayKey: "2026-10-12", bonus: true },
  { dayKey: "2026-10-13", bonus: true },
  { dayKey: "2026-10-14", bonus: false },
];

describe("consistency streaks", () => {
  it("keeps a streak through an unfinished today and ends it once that day is over", () => {
    expect(consistencyStreak(days, "2026-10-14")).toBe(2);
    expect(consistencyStreak(days, "2026-10-15")).toBe(0);
    expect(consistencyStreak([{ dayKey: "2026-10-14", bonus: true }], "2026-10-14")).toBe(1);
  });

  it("ignores future days and measures the longest run inside one duel", () => {
    expect(consistencyStreak([...days, { dayKey: "2026-10-16", bonus: true }], "2026-10-15")).toBe(0);
    expect(longestConsistencyStreak([...days, { dayKey: "2026-10-15", bonus: true }, { dayKey: "2026-10-16", bonus: true }])).toBe(2);
  });

  it("does not call today a miss", () => {
    expect(dayPhase("2026-10-14", "2026-10-14", false, false)).toBe("current");
    expect(dayPhase("2026-10-15", "2026-10-14", false, false)).toBe("future");
    expect(dayPhase("2026-10-13", "2026-10-14", true, true)).toBe("completed");
    expect(dayPhase("2026-10-13", "2026-10-14", false, true)).toBe("partial");
    expect(dayPhase("2026-10-12", "2026-10-14", false, false)).toBe("missed");
  });
});

describe("battle showcase", () => {
  it("stays at zero until a duel is actually finished", () => {
    expect(summarizeShowcase([])).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      longestStreak: 0,
    });
  });

  it("counts wins, losses, draws, and streaks from completed duels only", () => {
    const newest: ShowcaseBattle = {
      id: "new",
      title: "October",
      startsOn: "2026-10-12",
      opponent: "Sam",
      yourScore: 40,
      theirScore: 40,
      result: "draw",
      days,
    };
    const older: ShowcaseBattle = {
      id: "old",
      title: "September",
      startsOn: "2026-09-01",
      opponent: "Sam",
      yourScore: 90,
      theirScore: 20,
      result: "win",
      days: [
        { dayKey: "2026-09-01", bonus: true },
        { dayKey: "2026-09-02", bonus: true },
        { dayKey: "2026-09-03", bonus: true },
      ],
    };
    expect(summarizeShowcase([newest, older])).toMatchObject({
      played: 2,
      wins: 1,
      losses: 0,
      draws: 1,
      currentStreak: 0,
      longestStreak: 3,
    });
  });
});
