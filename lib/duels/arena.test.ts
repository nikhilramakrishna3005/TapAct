import { describe, expect, it } from "vitest";
import {
  arenaLead,
  arenaReactions,
  dayHasMetTarget,
  friendIsLive,
  leadCopy,
  momentumShares,
  victoryPresentation,
  youAreTrackingDuel,
} from "./arena";

describe("cinematic arena presentation", () => {
  it("derives lead only from server scores and stays neutral when tied or waiting", () => {
    expect(arenaLead(40, null)).toBe("waiting");
    expect(arenaLead(0, 0)).toBe("tie");
    expect(arenaLead(40, 40)).toBe("tie");
    expect(arenaLead(50, 40)).toBe("you");
    expect(arenaLead(20, 40)).toBe("friend");
    expect(leadCopy("tie")).toBe("Tied");
    expect(leadCopy("waiting")).toBe("Waiting");
  });

  it("splits momentum as a score share, never as health, and stays 50/50 when tied or waiting", () => {
    expect(momentumShares(80, 20)).toEqual({ youPercent: 80, friendPercent: 20, total: 100, awaiting: false });
    expect(momentumShares(0, 0)).toEqual({ youPercent: 50, friendPercent: 50, total: 0, awaiting: false });
    expect(momentumShares(30, 30)).toEqual({ youPercent: 50, friendPercent: 50, total: 60, awaiting: false });
    expect(momentumShares(40, null)).toMatchObject({ youPercent: 50, friendPercent: 50, awaiting: true });
    expect(momentumShares(20, 10).youPercent + momentumShares(20, 10).friendPercent).toBe(100);
  });

  it("does not invent live presence or tracking", () => {
    expect(youAreTrackingDuel({ youStatus: "active", activeActivityId: "run", mappings: [{ trackerActivityId: "run" }] })).toBe(true);
    expect(youAreTrackingDuel({ youStatus: "active", activeActivityId: "read", mappings: [{ trackerActivityId: "run" }] })).toBe(false);
    expect(youAreTrackingDuel({ youStatus: "left", activeActivityId: "run", mappings: [{ trackerActivityId: "run" }] })).toBe(false);
    expect(friendIsLive({ friendStatus: "active", presence: { activity: "Reading" } })).toBe(true);
    expect(friendIsLive({ friendStatus: "left", presence: { activity: "Reading" } })).toBe(false);
    expect(friendIsLive({ friendStatus: "active", presence: null })).toBe(false);
    expect(dayHasMetTarget([{ met: false }, { met: true }])).toBe(true);
    expect(dayHasMetTarget([{ met: false }])).toBe(false);
  });

  it("applies restrained reactions only from real events and quiets them after the duel ends", () => {
    const live = arenaReactions({
      lead: "you",
      youTracking: true,
      friendLive: true,
      youMetToday: true,
      friendMetToday: false,
      final: false,
    });
    expect(live).toEqual({
      youLive: true,
      friendLive: true,
      youAchieved: true,
      friendAchieved: false,
      youLead: true,
      friendLead: false,
      vsEnergy: true,
    });
    expect(arenaReactions({
      lead: "friend",
      youTracking: true,
      friendLive: true,
      youMetToday: true,
      friendMetToday: true,
      final: true,
    })).toEqual({
      youLive: false,
      friendLive: false,
      youAchieved: true,
      friendAchieved: true,
      youLead: false,
      friendLead: false,
      vsEnergy: false,
    });
  });

  it("presents a completed result from official scores without inventing trophies", () => {
    expect(victoryPresentation({
      final: false,
      unsynced: false,
      winner: null,
      youScore: 20,
      friendScore: 10,
      youStreak: 2,
      friendStreak: 0,
      friendName: "Ada",
    })).toBeNull();
    expect(victoryPresentation({
      final: true,
      unsynced: true,
      winner: "you",
      youScore: 80,
      friendScore: 40,
      youStreak: 3,
      friendStreak: 1,
      friendName: "Ada",
    })).toEqual({
      kind: "provisional",
      title: "Period ended",
      detail: "This result isn't final until tracking syncs.",
    });
    expect(victoryPresentation({
      final: true,
      unsynced: false,
      winner: "tie",
      youScore: 60,
      friendScore: 60,
      youStreak: 2,
      friendStreak: 2,
      friendName: "Ada",
    })?.title).toBe("It's a tie.");
    expect(victoryPresentation({
      final: true,
      unsynced: false,
      winner: "you",
      youScore: 80,
      friendScore: 40,
      youStreak: 3,
      friendStreak: 0,
      friendName: "Ada",
    })).toMatchObject({ kind: "you", title: "You won.", detail: "80–40 · 3-day consistency streak." });
  });
});
