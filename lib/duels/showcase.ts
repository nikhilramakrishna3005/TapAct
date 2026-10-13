import type { DuelBoard } from "./api";
import { consistencyStreak, longestConsistencyStreak, type StreakDay } from "./streak";

export type ShowcaseBattle = {
  id: string;
  title: string;
  startsOn: string;
  opponent: string;
  yourScore: number;
  theirScore: number;
  result: "win" | "loss" | "draw";
  days: StreakDay[];
};

export type ShowcaseSummary = {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Trailing consistency run on the newest completed duel. */
  currentStreak: number;
  /** Longest consistency run inside any one completed duel. */
  longestStreak: number;
};

export function battleFromBoard(board: DuelBoard): ShowcaseBattle | null {
  if (!board.duel.final || !board.friend || !board.duel.winner) return null;
  return {
    id: board.duel.id,
    title: board.duel.title,
    startsOn: board.duel.startsOn,
    opponent: board.friend.name,
    yourScore: board.you.score,
    theirScore: board.friend.score,
    result: board.duel.winner === "you" ? "win" : board.duel.winner === "friend" ? "loss" : "draw",
    days: board.youDays.map((day) => ({ dayKey: day.dayKey, bonus: day.bonus })),
  };
}

/** `battles` must be newest first. Empty input is an honest zero record. */
export function summarizeShowcase(battles: ShowcaseBattle[]): ShowcaseSummary {
  const summary: ShowcaseSummary = {
    played: battles.length,
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: battles[0] ? consistencyStreak(battles[0].days, "9999-12-31") : 0,
    longestStreak: 0,
  };
  for (const battle of battles) {
    if (battle.result === "win") summary.wins += 1;
    else if (battle.result === "loss") summary.losses += 1;
    else summary.draws += 1;
    const run = longestConsistencyStreak(battle.days);
    if (run > summary.longestStreak) summary.longestStreak = run;
  }
  return summary;
}
