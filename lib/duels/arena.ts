export type ArenaLead = "waiting" | "tie" | "you" | "friend";

export function arenaLead(youScore: number, friendScore: number | null): ArenaLead {
  if (friendScore === null) return "waiting";
  if (youScore === friendScore) return "tie";
  return youScore > friendScore ? "you" : "friend";
}

export function leadCopy(lead: ArenaLead): string {
  if (lead === "waiting") return "Waiting";
  if (lead === "tie") return "Tied";
  if (lead === "you") return "You lead";
  return "They lead";
}

export function compactDuelStatus(input: {
  todayKey: string;
  startsOn: string;
  durationDays: number;
  dayIndex: number;
  completed: boolean;
}): string {
  if (input.completed) return "Completed";
  if (input.todayKey < input.startsOn) return "Upcoming";
  if (input.dayIndex >= 0) return `Day ${input.dayIndex + 1} of ${input.durationDays}`;
  return "Completed";
}

/** Score share for the momentum bar. This is not health or damage. */
export function momentumShares(youScore: number, friendScore: number | null): {
  youPercent: number;
  friendPercent: number;
  total: number;
  awaiting: boolean;
} {
  if (friendScore === null) {
    return { youPercent: 50, friendPercent: 50, total: Math.max(0, youScore), awaiting: true };
  }
  const you = Math.max(0, youScore);
  const friend = Math.max(0, friendScore);
  const total = you + friend;
  if (total === 0) return { youPercent: 50, friendPercent: 50, total: 0, awaiting: false };
  const youPercent = Math.round((you / total) * 100);
  return { youPercent, friendPercent: 100 - youPercent, total, awaiting: false };
}

export function youAreTrackingDuel(input: {
  youStatus: string;
  activeActivityId: string | null;
  mappings: { trackerActivityId: string }[];
}): boolean {
  if (input.youStatus !== "active" || !input.activeActivityId) return false;
  return input.mappings.some((item) => item.trackerActivityId === input.activeActivityId);
}

export function friendIsLive(input: {
  friendStatus?: string | null;
  presence: { activity: string } | null;
}): boolean {
  return Boolean(input.presence && input.friendStatus && input.friendStatus !== "left");
}

export function dayHasMetTarget(activities: { met: boolean }[] | undefined): boolean {
  return Boolean(activities?.some((item) => item.met));
}

export type ArenaReaction = {
  youLive: boolean;
  friendLive: boolean;
  youAchieved: boolean;
  friendAchieved: boolean;
  youLead: boolean;
  friendLead: boolean;
  vsEnergy: boolean;
};

export function arenaReactions(input: {
  lead: ArenaLead;
  youTracking: boolean;
  friendLive: boolean;
  youMetToday: boolean;
  friendMetToday: boolean;
  final: boolean;
}): ArenaReaction {
  return {
    youLive: input.youTracking && !input.final,
    friendLive: input.friendLive && !input.final,
    youAchieved: input.youMetToday,
    friendAchieved: input.friendMetToday,
    youLead: input.lead === "you" && !input.final,
    friendLead: input.lead === "friend" && !input.final,
    vsEnergy: input.youTracking && input.friendLive && !input.final,
  };
}

export function victoryPresentation(input: {
  final: boolean;
  unsynced: boolean;
  winner: "you" | "friend" | "tie" | null;
  youScore: number;
  friendScore: number;
  youStreak: number;
  friendStreak: number;
  friendName: string;
}): { kind: "provisional" | "you" | "friend" | "tie"; title: string; detail: string } | null {
  if (!input.final) return null;
  if (input.unsynced) {
    return {
      kind: "provisional",
      title: "Period ended",
      detail: "This result isn't final until tracking syncs.",
    };
  }
  const scoreline = `${input.youScore}–${input.friendScore}`;
  if (input.winner === "tie") {
    return {
      kind: "tie",
      title: "It's a tie.",
      detail: `${scoreline}. Equal points. Consistency streaks stay as recorded.`,
    };
  }
  if (input.winner === "you") {
    return {
      kind: "you",
      title: "You won.",
      detail: input.youStreak > 0 ? `${scoreline} · ${input.youStreak}-day consistency streak.` : `${scoreline}.`,
    };
  }
  return {
    kind: "friend",
    title: `${input.friendName} won.`,
    detail: input.friendStreak > 0 ? `${scoreline} · their ${input.friendStreak}-day consistency streak.` : `${scoreline}.`,
  };
}
