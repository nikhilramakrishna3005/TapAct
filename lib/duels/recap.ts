import type { BoardDay } from "./api";
import { TARGET_POINTS, addCalendarDays, compareScores, startOfZonedDay } from "./score";

export type LeadChange =
  | "took-lead"
  | "lost-lead"
  | "extended"
  | "opponent-extended"
  | "narrowed"
  | "held"
  | "opponent-held"
  | "reached-tie"
  | "stayed-tied";

export type RecapSide = "you" | "friend" | "tie";

export type RecapActivity = {
  id: string;
  name: string;
  targetMinutes: number;
  youMinutes: number;
  friendMinutes: number;
  youMet: boolean;
  friendMet: boolean;
  youPoints: number;
  friendPoints: number;
};

export type RecapDay = {
  dayKey: string;
  dayNumber: number;
  durationDays: number;
  final: boolean;
  youDaily: number;
  friendDaily: number;
  youCumulative: number;
  friendCumulative: number;
  youBonus: boolean;
  friendBonus: boolean;
  dailyWinner: RecapSide;
  cumulativeLeader: RecapSide;
  leadChange: LeadChange;
  headline: string;
  summary: string;
  activities: RecapActivity[];
};

export type RecapAvailability = "pending" | "cancelled" | "needs-zones" | "empty" | "ready";

const HEADLINES = {
  owned: "You owned the day.",
  close: "A close battle today.",
  took: "You took the lead.",
  held: "You held your lead.",
  pulled: "Your opponent pulled ahead.",
  perfect: "A perfect day.",
  tied: "The battle is tied.",
  none: "No verified progress today.",
  narrowed: "You narrowed the gap.",
  opponentHeld: "Your opponent held the lead.",
  live: "Today is still open.",
} as const;

export function competitionDayFinal(dayKey: string, zones: string[], nowMs: number): boolean {
  if (zones.length < 2 || zones.some((zone) => !zone)) return false;
  const next = addCalendarDays(dayKey, 1);
  return zones.every((zone) => nowMs >= startOfZonedDay(next, zone));
}

export function completedRecapDays(dayKeys: string[], zones: string[], nowMs: number): string[] {
  return dayKeys.filter((dayKey) => competitionDayFinal(dayKey, zones, nowMs));
}

/** Earliest competition day that has started somewhere and has not ended in both zones. */
export function liveRecapDay(dayKeys: string[], zones: string[], nowMs: number): string | null {
  if (zones.length < 2) return null;
  const live = dayKeys.filter((dayKey) => {
    if (competitionDayFinal(dayKey, zones, nowMs)) return false;
    const started = Math.min(...zones.map((zone) => startOfZonedDay(dayKey, zone)));
    return nowMs >= started;
  });
  return live[0] ?? null;
}

export function cumulativeThrough(days: BoardDay[], dayKey: string): number {
  return days.reduce((sum, day) => (day.dayKey <= dayKey ? sum + day.points : sum), 0);
}

export function progressPercent(minutes: number, targetMinutes: number): number {
  if (targetMinutes <= 0 || minutes <= 0) return 0;
  return Math.min(100, Math.round((minutes / targetMinutes) * 100));
}

export function leadChange(beforeYou: number, beforeFriend: number, afterYou: number, afterFriend: number): LeadChange {
  const before = compareScores(beforeYou, beforeFriend);
  const after = compareScores(afterYou, afterFriend);
  if (before !== "a" && after === "a") return "took-lead";
  if (before !== "b" && after === "b") return "lost-lead";
  if (before !== "tie" && after === "tie") return "reached-tie";
  if (before === "tie" && after === "tie") return "stayed-tied";
  const beforeGap = Math.abs(beforeYou - beforeFriend);
  const afterGap = Math.abs(afterYou - afterFriend);
  if (after === "a") {
    if (afterGap > beforeGap) return "extended";
    if (afterGap < beforeGap) return "narrowed";
    return "held";
  }
  if (afterGap > beforeGap) return "opponent-extended";
  if (afterGap < beforeGap) return "narrowed";
  return "opponent-held";
}

export function selectRecapHeadline(input: {
  final: boolean;
  youDaily: number;
  friendDaily: number;
  youBonus: boolean;
  leadChange: LeadChange;
}): string {
  if (!input.final) return HEADLINES.live;
  if (input.youDaily === 0 && input.friendDaily === 0) return HEADLINES.none;
  if (input.leadChange === "took-lead") return HEADLINES.took;
  if (input.leadChange === "lost-lead") return HEADLINES.pulled;
  if (input.leadChange === "reached-tie" || input.leadChange === "stayed-tied") return HEADLINES.tied;
  if (input.youBonus && input.youDaily >= input.friendDaily) return HEADLINES.perfect;
  if (input.leadChange === "narrowed") return HEADLINES.narrowed;
  const margin = input.youDaily - input.friendDaily;
  const blowout = input.youDaily > input.friendDaily && (input.friendDaily === 0 || margin >= 40);
  if ((input.leadChange === "held" || input.leadChange === "extended") && blowout) return HEADLINES.owned;
  if (input.leadChange === "held" || input.leadChange === "extended") return HEADLINES.held;
  if (input.leadChange === "opponent-held" || input.leadChange === "opponent-extended") return HEADLINES.opponentHeld;
  if (blowout) return HEADLINES.owned;
  if (margin > 0 && margin <= 20) return HEADLINES.close;
  if (margin > 20) return HEADLINES.owned;
  return HEADLINES.close;
}

export function leadChangeLabel(change: LeadChange): string {
  switch (change) {
    case "took-lead":
      return "You took the lead";
    case "lost-lead":
      return "Your opponent took the lead";
    case "extended":
      return "Your lead grew";
    case "opponent-extended":
      return "Their lead grew";
    case "narrowed":
      return "The gap narrowed";
    case "held":
      return "You kept the lead";
    case "opponent-held":
      return "They kept the lead";
    case "reached-tie":
      return "The score is now tied";
    case "stayed-tied":
      return "The score stayed tied";
  }
}

export function recapDateLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function recapSummary(input: {
  final: boolean;
  youName: string;
  friendName: string;
  dayNumber: number;
  youDaily: number;
  friendDaily: number;
  youCumulative: number;
  friendCumulative: number;
  dailyWinner: RecapSide;
  cumulativeLeader: RecapSide;
}): string {
  const today = input.final
    ? `${input.youName} earned ${input.youDaily} today. ${input.friendName} earned ${input.friendDaily}.`
    : `${input.youName} has ${input.youDaily} so far. ${input.friendName} has ${input.friendDaily}. This day is not final.`;
  const leader = input.cumulativeLeader === "tie"
    ? `Through day ${input.dayNumber} the score is tied ${input.youCumulative}–${input.friendCumulative}.`
    : input.cumulativeLeader === "you"
      ? `Through day ${input.dayNumber} ${input.youName} leads ${input.youCumulative}–${input.friendCumulative}.`
      : `Through day ${input.dayNumber} ${input.friendName} leads ${input.friendCumulative}–${input.youCumulative}.`;
  const daily = input.final
    ? input.dailyWinner === "tie"
      ? " Today was a tie."
      : input.dailyWinner === "you"
        ? ` ${input.youName} won the day.`
        : ` ${input.friendName} won the day.`
    : "";
  return `${today} ${leader}${daily}`;
}

function side(you: number, friend: number): RecapSide {
  const result = compareScores(you, friend);
  if (result === "tie") return "tie";
  return result === "a" ? "you" : "friend";
}

function activityPoints(met: boolean): number {
  return met ? TARGET_POINTS : 0;
}

/** Shared duel activities only. Extra fields such as tracker ids are dropped. */
export function recapActivities(you: BoardDay | undefined, friend: BoardDay | undefined): RecapActivity[] {
  const yours = you?.activities ?? [];
  const theirs = friend?.activities ?? [];
  const ids = [...yours.map((item) => item.id), ...theirs.map((item) => item.id).filter((id) => !yours.some((item) => item.id === id))];
  return ids.map((id) => {
    const mine = yours.find((item) => item.id === id);
    const other = theirs.find((item) => item.id === id);
    const target = mine?.targetMinutes ?? other?.targetMinutes ?? 0;
    return {
      id,
      name: mine?.name || other?.name || "Activity",
      targetMinutes: target,
      youMinutes: mine?.minutes ?? 0,
      friendMinutes: other?.minutes ?? 0,
      youMet: Boolean(mine?.met),
      friendMet: Boolean(other?.met),
      youPoints: activityPoints(Boolean(mine?.met)),
      friendPoints: activityPoints(Boolean(other?.met)),
    };
  });
}

export function buildRecapDay(input: {
  dayKey: string;
  dayNumber: number;
  durationDays: number;
  final: boolean;
  youName: string;
  friendName: string;
  youDays: BoardDay[];
  friendDays: BoardDay[];
}): RecapDay {
  const you = input.youDays.find((day) => day.dayKey === input.dayKey);
  const friend = input.friendDays.find((day) => day.dayKey === input.dayKey);
  const youDaily = you?.points ?? 0;
  const friendDaily = friend?.points ?? 0;
  const youCumulative = cumulativeThrough(input.youDays, input.dayKey);
  const friendCumulative = cumulativeThrough(input.friendDays, input.dayKey);
  const previousKey = input.youDays.map((day) => day.dayKey).filter((dayKey) => dayKey < input.dayKey).at(-1);
  const beforeYou = previousKey ? cumulativeThrough(input.youDays, previousKey) : 0;
  const beforeFriend = previousKey ? cumulativeThrough(input.friendDays, previousKey) : 0;
  const change = leadChange(beforeYou, beforeFriend, youCumulative, friendCumulative);
  const youBonus = Boolean(you?.bonus);
  const dailyWinner = side(youDaily, friendDaily);
  const cumulativeLeader = side(youCumulative, friendCumulative);
  return {
    dayKey: input.dayKey,
    dayNumber: input.dayNumber,
    durationDays: input.durationDays,
    final: input.final,
    youDaily,
    friendDaily,
    youCumulative,
    friendCumulative,
    youBonus,
    friendBonus: Boolean(friend?.bonus),
    dailyWinner,
    cumulativeLeader,
    leadChange: change,
    headline: selectRecapHeadline({
      final: input.final,
      youDaily,
      friendDaily,
      youBonus,
      leadChange: change,
    }),
    summary: recapSummary({
      final: input.final,
      youName: input.youName,
      friendName: input.friendName,
      dayNumber: input.dayNumber,
      youDaily,
      friendDaily,
      youCumulative,
      friendCumulative,
      dailyWinner,
      cumulativeLeader,
    }),
    activities: recapActivities(you, friend),
  };
}

export function recapAvailability(input: {
  status: string;
  hasFriend: boolean;
  youZone?: string | null;
  friendZone?: string | null;
  completedCount: number;
}): RecapAvailability {
  if (input.status === "pending" || !input.hasFriend) return "pending";
  if (input.status === "cancelled") return "cancelled";
  if (!input.youZone || !input.friendZone) return "needs-zones";
  if (input.completedCount === 0) return "empty";
  return "ready";
}

export function recapHighlight(seenDay: string | null, newestCompleted: string | null): boolean {
  return newestCompleted != null && seenDay !== newestCompleted;
}

export function recapSeenKey(duelId: string): string {
  return `tapact.recap.seen.${duelId}`;
}

export function recapMotion(reduced: boolean): { duration: number } {
  return { duration: reduced ? 0 : 0.22 };
}
