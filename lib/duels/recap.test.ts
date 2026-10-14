import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BoardDay } from "./api";
import {
  buildRecapDay,
  competitionDayFinal,
  completedRecapDays,
  cumulativeThrough,
  leadChange,
  liveRecapDay,
  progressPercent,
  recapActivities,
  recapAvailability,
  recapHighlight,
  recapMotion,
  selectRecapHeadline,
} from "./recap";
import { startOfZonedDay } from "./score";

function day(dayKey: string, points: number, activities: BoardDay["activities"] = [], bonus = false): BoardDay {
  return { dayKey, points, bonus, activities };
}

const zones = ["America/New_York", "America/Los_Angeles"];

describe("daily recap scoring display", () => {
  const youDays = [
    day("2026-10-12", 50, [
      { id: "read", name: "Read", targetMinutes: 20, minutes: 25, met: true },
      { id: "move", name: "Move", targetMinutes: 30, minutes: 30, met: true },
    ], true),
    day("2026-10-13", 20, [
      { id: "read", name: "Read", targetMinutes: 40, minutes: 40, met: true },
      { id: "move", name: "Move", targetMinutes: 30, minutes: 0, met: false },
    ]),
  ];
  const friendDays = [
    day("2026-10-12", 20, [
      { id: "read", name: "Read", targetMinutes: 20, minutes: 20, met: true },
      { id: "move", name: "Move", targetMinutes: 30, minutes: 10, met: false },
    ]),
    day("2026-10-13", 0, [
      { id: "read", name: "Read", targetMinutes: 40, minutes: 0, met: false },
      { id: "move", name: "Move", targetMinutes: 30, minutes: 0, met: false },
    ]),
  ];

  it("keeps that day's points separate from the cumulative total and from the live duel total", () => {
    const recap = buildRecapDay({
      dayKey: "2026-10-13",
      dayNumber: 2,
      durationDays: 7,
      final: true,
      youName: "You",
      friendName: "Alex",
      youDays,
      friendDays,
    });
    expect(recap.youDaily).toBe(20);
    expect(recap.friendDaily).toBe(0);
    expect(recap.youCumulative).toBe(70);
    expect(recap.friendCumulative).toBe(20);
    expect(cumulativeThrough(youDays, "2026-10-12")).toBe(50);
    expect(recap.dailyWinner).toBe("you");
    expect(recap.cumulativeLeader).toBe("you");
    expect(recap.activities[0].targetMinutes).toBe(40);
    expect(recap.activities[0].youPoints).toBe(20);
    expect(recap.activities[1].youPoints).toBe(0);
    expect(recap.youBonus).toBe(false);
  });

  it("uses the target stored on that day when rules changed", () => {
    const first = buildRecapDay({
      dayKey: "2026-10-12",
      dayNumber: 1,
      durationDays: 7,
      final: true,
      youName: "You",
      friendName: "Alex",
      youDays,
      friendDays,
    });
    expect(first.activities.find((item) => item.id === "read")?.targetMinutes).toBe(20);
    expect(first.youBonus).toBe(true);
    expect(first.headline).toBe("You took the lead.");
  });

  it("does not treat a daily win as the competition result", () => {
    const recap = buildRecapDay({
      dayKey: "2026-10-12",
      dayNumber: 1,
      durationDays: 7,
      final: true,
      youName: "You",
      friendName: "Alex",
      youDays: [day("2026-10-12", 20)],
      friendDays: [day("2026-10-12", 0), day("2026-10-13", 80)],
    });
    expect(recap.dailyWinner).toBe("you");
    expect(recap.cumulativeLeader).toBe("you");
    expect(recap.summary).toContain("won the day");
    expect(recap.summary).not.toContain("won the duel");
  });
});

describe("lead changes", () => {
  it("detects taking, losing, extending, narrowing, and ties from cumulative scores", () => {
    expect(leadChange(0, 0, 20, 0)).toBe("took-lead");
    expect(leadChange(20, 0, 20, 40)).toBe("lost-lead");
    expect(leadChange(20, 0, 50, 10)).toBe("extended");
    expect(leadChange(40, 0, 40, 20)).toBe("narrowed");
    expect(leadChange(20, 20, 40, 40)).toBe("stayed-tied");
    expect(leadChange(40, 20, 40, 40)).toBe("reached-tie");
    expect(leadChange(40, 20, 60, 40)).toBe("held");
    expect(selectRecapHeadline({ final: true, youDaily: 20, friendDaily: 0, youBonus: false, leadChange: "took-lead" })).toBe("You took the lead.");
    expect(selectRecapHeadline({ final: true, youDaily: 0, friendDaily: 20, youBonus: false, leadChange: "lost-lead" })).toBe("Your opponent pulled ahead.");
    expect(selectRecapHeadline({ final: true, youDaily: 20, friendDaily: 20, youBonus: false, leadChange: "stayed-tied" })).toBe("The battle is tied.");
    expect(selectRecapHeadline({ final: true, youDaily: 0, friendDaily: 0, youBonus: false, leadChange: "held" })).toBe("No verified progress today.");
    expect(selectRecapHeadline({ final: false, youDaily: 50, friendDaily: 0, youBonus: true, leadChange: "took-lead" })).toBe("Today is still open.");
  });

  it("does not call a blowout a lead change when the lead was already yours", () => {
    const recap = buildRecapDay({
      dayKey: "2026-10-13",
      dayNumber: 2,
      durationDays: 7,
      final: true,
      youName: "You",
      friendName: "Alex",
      youDays: [day("2026-10-12", 50, [], true), day("2026-10-13", 50, [], true)],
      friendDays: [day("2026-10-12", 0), day("2026-10-13", 0)],
    });
    expect(recap.leadChange).toBe("extended");
    expect(recap.headline).toBe("A perfect day.");
    expect(recap.summary).toContain("You leads 100–0");
  });

  it("shows a zero-progress day instead of hiding it", () => {
    const recap = buildRecapDay({
      dayKey: "2026-10-13",
      dayNumber: 2,
      durationDays: 7,
      final: true,
      youName: "You",
      friendName: "Alex",
      youDays: [day("2026-10-12", 20), day("2026-10-13", 0, [{ id: "read", name: "Read", targetMinutes: 20, minutes: 0, met: false }])],
      friendDays: [day("2026-10-12", 20), day("2026-10-13", 0, [{ id: "read", name: "Read", targetMinutes: 20, minutes: 0, met: false }])],
    });
    expect(recap.headline).toBe("No verified progress today.");
    expect(recap.activities).toHaveLength(1);
    expect(recap.youCumulative).toBe(20);
    expect(recap.leadChange).toBe("stayed-tied");
  });
});

describe("time zones and unfinished days", () => {
  it("waits until the day has ended in both frozen zones, including across daylight saving", () => {
    const nyEnd = startOfZonedDay("2026-03-09", "America/New_York");
    const laEnd = startOfZonedDay("2026-03-09", "America/Los_Angeles");
    expect(nyEnd).toBeLessThan(laEnd);
    expect(competitionDayFinal("2026-03-08", zones, nyEnd)).toBe(false);
    expect(competitionDayFinal("2026-03-08", zones, laEnd)).toBe(true);
    const fallNy = startOfZonedDay("2026-11-02", "America/New_York");
    const fallLa = startOfZonedDay("2026-11-02", "America/Los_Angeles");
    expect(competitionDayFinal("2026-11-01", zones, fallNy)).toBe(false);
    expect(competitionDayFinal("2026-11-01", zones, fallLa)).toBe(true);
  });

  it("does not treat a later zone's tomorrow as a completed recap", () => {
    const keys = ["2026-10-12", "2026-10-13"];
    const tokyo = "Asia/Tokyo";
    const hawaii = "Pacific/Honolulu";
    const afterTokyo = startOfZonedDay("2026-10-13", tokyo);
    expect(completedRecapDays(keys, [tokyo, hawaii], afterTokyo)).toEqual([]);
    expect(liveRecapDay(keys, [tokyo, hawaii], afterTokyo)).toBe("2026-10-12");
    const afterHawaii = startOfZonedDay("2026-10-13", hawaii);
    expect(completedRecapDays(keys, [tokyo, hawaii], afterHawaii)).toEqual(["2026-10-12"]);
    expect(completedRecapDays(keys, [tokyo, hawaii], afterHawaii)).not.toContain("2026-10-13");
  });
});

describe("recap access and privacy", () => {
  it("keeps pending and cancelled duels out of completed recaps", () => {
    expect(recapAvailability({ status: "pending", hasFriend: false, youZone: "UTC", friendZone: null, completedCount: 0 })).toBe("pending");
    expect(recapAvailability({ status: "cancelled", hasFriend: true, youZone: "UTC", friendZone: "UTC", completedCount: 2 })).toBe("cancelled");
    expect(recapAvailability({ status: "active", hasFriend: true, youZone: "UTC", friendZone: "UTC", completedCount: 0 })).toBe("empty");
    expect(recapAvailability({ status: "completed", hasFriend: true, youZone: "UTC", friendZone: "UTC", completedCount: 7 })).toBe("ready");
    expect(recapAvailability({ status: "active", hasFriend: true, completedCount: 3 })).toBe("needs-zones");
  });

  it("drops private fields and caps progress at 100 percent", () => {
    const rows = recapActivities(
      {
        dayKey: "2026-10-12",
        points: 20,
        bonus: false,
        activities: [{ id: "read", name: "Read", targetMinutes: 20, minutes: 80, met: true, trackerActivityId: "secret" } as BoardDay["activities"][number]],
      },
      { dayKey: "2026-10-12", points: 0, bonus: false, activities: [] },
    );
    expect(rows[0]).toEqual({
      id: "read",
      name: "Read",
      targetMinutes: 20,
      youMinutes: 80,
      friendMinutes: 0,
      youMet: true,
      friendMet: false,
      youPoints: 20,
      friendPoints: 0,
    });
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(progressPercent(80, 20)).toBe(100);
    expect(progressPercent(0, 20)).toBe(0);
  });

  it("highlights a new completed day once and stays quiet when motion is reduced", () => {
    expect(recapHighlight(null, "2026-10-12")).toBe(true);
    expect(recapHighlight("2026-10-12", "2026-10-12")).toBe(false);
    expect(recapHighlight("2026-10-12", "2026-10-13")).toBe(true);
    expect(recapMotion(true)).toEqual({ duration: 0 });
    expect(recapMotion(false).duration).toBeGreaterThan(0);
  });
});

describe("recap migration", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261015010000_tapact_duel_recap_zones.sql"), "utf8");

  it("adds frozen time zones to the existing board without replacing the scorer", () => {
    expect(sql).toContain("you_score := public.tapact_duel_member_score(p_duel, uid)");
    expect(sql).toContain("'timeZone', me.time_zone");
    expect(sql).toContain("'timeZone', friend.time_zone");
    expect(sql).toContain("if uid is null or not public.tapact_duel_is_member(p_duel)");
    expect(sql).toContain("grant execute on function public.tapact_duel_board(uuid) to authenticated");
    expect(sql).not.toContain("create or replace function public.tapact_duel_member_score");
    expect(sql).not.toContain("tapact_notifications");
    expect(sql).not.toContain("service_role");
  });
});
