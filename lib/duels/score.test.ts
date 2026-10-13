import { describe, expect, it } from "vitest";
import { inviteBlockMessage, inviteDecision, validateDuelDraft } from "./invite";
import {
  compareScores,
  duelIsFinal,
  officialStartDate,
  scoreMember,
  startOfZonedDay,
  type ScoreMember,
  zonedDayKey,
} from "./score";

const MIN = 60_000;
const ZONE = "America/New_York";

function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

function member(partial: Partial<ScoreMember> & Pick<ScoreMember, "sessions">): ScoreMember {
  return {
    id: "you",
    timeZone: ZONE,
    activities: [
      { id: "read", targetMinutes: 20, trackerActivityId: "reading" },
      { id: "move", targetMinutes: 30, trackerActivityId: "gym" },
    ],
    ...partial,
  };
}

describe("duel scoring", () => {
  it("awards 20 per target and 10 for a perfect day, with no extra points past the target", () => {
    const scored = scoreMember(
      member({
        sessions: [
          { activityId: "reading", startMs: at(12, 8), endMs: at(12, 9) },
          { activityId: "gym", startMs: at(12, 18), endMs: at(12, 18, 30) },
        ],
      }),
      "2026-10-12",
      7,
    );
    expect(scored.days[0]).toMatchObject({ points: 50, bonus: true });
    expect(scored.days[0].activities.map((item) => item.met)).toEqual([true, true]);
    expect(scored.points).toBe(50);
  });

  it("ignores manual and deleted sessions and unions overlapping timer time", () => {
    const scored = scoreMember(
      member({
        activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
        sessions: [
          { activityId: "reading", startMs: at(12, 8), endMs: at(12, 8, 15), source: "timer" },
          { activityId: "reading", startMs: at(12, 8, 10), endMs: at(12, 8, 25), source: "timer" },
          { activityId: "reading", startMs: at(12, 9), endMs: at(12, 10), source: "manual" },
          { activityId: "reading", startMs: at(12, 11), endMs: at(12, 12), deletedAtMs: 1, source: "timer" },
        ],
      }),
      "2026-10-12",
      7,
    );
    expect(scored.days[0].activities[0].minutes).toBe(25);
    expect(scored.days[0].points).toBe(30);
  });

  it("excludes time before the agreed start and after the member leaves", () => {
    const scored = scoreMember(
      member({
        leftAtMs: at(12, 12),
        activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
        sessions: [
          { activityId: "reading", startMs: at(11, 21), endMs: at(11, 22), source: "timer" },
          { activityId: "reading", startMs: at(12, 9), endMs: at(12, 10), source: "timer" },
          { activityId: "reading", startMs: at(12, 13), endMs: at(12, 14), source: "timer" },
        ],
      }),
      "2026-10-12",
      7,
    );
    expect(scored.days[0].activities[0].minutes).toBe(60);
    expect(scored.days[1].activities[0].minutes).toBe(0);
    expect(scored.points).toBe(30);
  });

  it("uses the frozen time zone, so a later device zone cannot move the day", () => {
    const utcLate = Date.parse("2026-10-13T02:30:00.000Z");
    expect(zonedDayKey(utcLate, "America/New_York")).toBe("2026-10-12");
    expect(zonedDayKey(utcLate, "UTC")).toBe("2026-10-13");
    const scored = scoreMember(
      member({
        timeZone: "America/New_York",
        activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
        sessions: [{ activityId: "reading", startMs: utcLate, endMs: utcLate + 30 * MIN, source: "timer" }],
      }),
      "2026-10-12",
      7,
    );
    expect(scored.days[0].activities[0].minutes).toBe(30);
    expect(scored.days[1].activities[0].minutes).toBe(0);
  });

  it("splits a session that crosses a zoned midnight", () => {
    const start = Date.parse("2026-10-12T03:30:00.000Z");
    const end = start + 60 * MIN;
    expect(zonedDayKey(start, ZONE)).toBe("2026-10-11");
    const scored = scoreMember(
      member({
        activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
        sessions: [{ activityId: "reading", startMs: start, endMs: end, source: "timer" }],
      }),
      "2026-10-11",
      7,
    );
    const first = scored.days[0].activities[0].minutes;
    const second = scored.days[1].activities[0].minutes;
    expect(first + second).toBe(60);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
  });

  it("keeps a future start when both have accepted before that day begins", () => {
    const acceptedAt = Date.parse("2026-10-12T16:00:00.000Z");
    expect(officialStartDate("2026-10-20", acceptedAt, [ZONE, "Asia/Tokyo"])).toBe("2026-10-20");
    const scored = scoreMember(
      member({
        activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
        sessions: [
          { activityId: "reading", startMs: Date.parse("2026-10-12T16:00:00.000Z"), endMs: Date.parse("2026-10-12T17:00:00.000Z"), source: "timer" },
          { activityId: "reading", startMs: Date.parse("2026-10-20T14:00:00.000Z"), endMs: Date.parse("2026-10-20T14:30:00.000Z"), source: "timer" },
        ],
      }),
      officialStartDate("2026-10-20", acceptedAt, [ZONE, "Asia/Tokyo"]),
      7,
    );
    expect(scored.days[0].dayKey).toBe("2026-10-20");
    expect(scored.days[0].activities[0].minutes).toBe(30);
    expect(scored.points).toBe(30);
  });

  it("drops same-day tracking when the invite is accepted after that day has started", () => {
    const acceptedAt = Date.parse("2026-10-12T16:00:00.000Z");
    const start = officialStartDate("2026-10-12", acceptedAt, [ZONE, ZONE]);
    expect(start).toBe("2026-10-13");
    const sessions = [
      { activityId: "reading", startMs: Date.parse("2026-10-12T13:00:00.000Z"), endMs: Date.parse("2026-10-12T14:00:00.000Z"), source: "timer" as const },
      { activityId: "reading", startMs: Date.parse("2026-10-13T14:00:00.000Z"), endMs: Date.parse("2026-10-13T14:30:00.000Z"), source: "timer" as const },
    ];
    for (const id of ["creator", "friend"]) {
      const scored = scoreMember(
        member({
          id,
          activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
          sessions,
        }),
        start,
        7,
      );
      expect(scored.days[0].dayKey).toBe("2026-10-13");
      expect(scored.days[0].activities[0].minutes).toBe(30);
      expect(scored.points).toBe(30);
    }
  });

  it("moves a late acceptance to the next day neither time zone has started", () => {
    const acceptedAt = Date.parse("2026-10-12T16:00:00.000Z");
    expect(zonedDayKey(acceptedAt, ZONE)).toBe("2026-10-12");
    expect(zonedDayKey(acceptedAt, "Asia/Tokyo")).toBe("2026-10-13");
    const start = officialStartDate("2026-10-12", acceptedAt, [ZONE, "Asia/Tokyo"]);
    expect(start).toBe("2026-10-14");
    const before = Date.parse("2026-10-13T02:00:00.000Z");
    const onStart = Date.parse("2026-10-14T12:00:00.000Z");
    for (const zone of [ZONE, "Asia/Tokyo"]) {
      const scored = scoreMember(
        member({
          timeZone: zone,
          activities: [{ id: "read", targetMinutes: 20, trackerActivityId: "reading" }],
          sessions: [
            { activityId: "reading", startMs: before, endMs: before + 40 * MIN, source: "timer" },
            { activityId: "reading", startMs: onStart, endMs: onStart + 25 * MIN, source: "timer" },
          ],
        }),
        start,
        7,
      );
      expect(scored.days[0].dayKey).toBe("2026-10-14");
      expect(scored.days.find((day) => day.dayKey === "2026-10-13")).toBeUndefined();
      expect(scored.days[0].activities[0].minutes).toBe(25);
      expect(scored.points).toBe(30);
    }
  });

  it("calls a tie a tie and waits for both time zones to finish", () => {
    expect(compareScores(40, 40)).toBe("tie");
    expect(compareScores(50, 40)).toBe("a");
    const laterEnd = Math.max(startOfZonedDay("2026-10-19", ZONE), startOfZonedDay("2026-10-19", "UTC"));
    expect(duelIsFinal(laterEnd - 1, "2026-10-12", 7, [ZONE, "UTC"])).toBe(false);
    expect(duelIsFinal(laterEnd, "2026-10-12", 7, [ZONE, "UTC"])).toBe(true);
    expect(duelIsFinal(laterEnd, "2026-10-12", 7, [ZONE])).toBe(false);
  });
});

describe("duel invites", () => {
  const base = {
    viewerId: "friend",
    creatorId: "owner",
    expiresAtMs: Date.parse("2026-10-20T00:00:00Z"),
    revoked: false,
    accepted: false,
    memberCount: 1,
    startsOn: "2026-10-12",
    durationDays: 7,
    nowMs: Date.parse("2026-10-12T15:00:00Z"),
    viewerZone: ZONE,
  };

  it("blocks self, reuse, expiry, a full duel, and acceptance after the period", () => {
    expect(inviteDecision(base)).toBe("ok");
    expect(inviteDecision({ ...base, viewerId: "owner" })).toBe("self");
    expect(inviteDecision({ ...base, viewerId: null })).toBe("sign-in");
    expect(inviteDecision({ ...base, accepted: true })).toBe("used");
    expect(inviteDecision({ ...base, revoked: true })).toBe("revoked");
    expect(inviteDecision({ ...base, nowMs: base.expiresAtMs })).toBe("expired");
    expect(inviteDecision({ ...base, memberCount: 2 })).toBe("full");
    expect(inviteDecision({ ...base, nowMs: Date.parse("2026-10-19T16:00:00Z") })).toBe("ended");
    expect(inviteBlockMessage("self")).toMatch(/own invite/);
  });

  it("rejects invalid drafts and keeps targets bounded", () => {
    const draft = {
      title: "Morning duel",
      durationDays: 7 as const,
      startsOn: "2026-10-12",
      timeZone: ZONE,
      activities: [{ name: "Read", targetMinutes: 20, trackerActivityId: "reading" }],
    };
    expect(validateDuelDraft(draft, "2026-10-12")).toEqual({ ok: true });
    expect(validateDuelDraft({ ...draft, startsOn: "2026-10-11" }, "2026-10-12").ok).toBe(false);
    expect(validateDuelDraft({ ...draft, startsOn: "2026-10-26" }, "2026-10-12").ok).toBe(true);
    expect(validateDuelDraft({ ...draft, startsOn: "2026-10-27" }, "2026-10-12").ok).toBe(false);
    expect(validateDuelDraft({ ...draft, activities: [{ ...draft.activities[0], targetMinutes: 4 }] }, "2026-10-12").ok).toBe(false);
    expect(validateDuelDraft({ ...draft, activities: [] }, "2026-10-12").ok).toBe(false);
  });
});
