/**
 * A consistency day is a duel day where every agreed target was met (the perfect-day bonus).
 * Extra minutes never create a consistency day by themselves.
 *
 * The current streak is the run of consistency days ending on the latest finished day.
 * Today counts only when it is already a consistency day. An unfinished today is not a miss.
 * Future days are ignored.
 *
 * The longest streak is the longest run inside one duel. It does not cross from one duel into another.
 */

export type StreakDay = { dayKey: string; bonus: boolean };

export function consistencyStreak(days: StreakDay[], todayKey: string): number {
  const ordered = [...days].sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  const finished = ordered.filter((day) => day.dayKey < todayKey || (day.dayKey === todayKey && day.bonus));
  let streak = 0;
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    if (!finished[index].bonus) break;
    streak += 1;
  }
  return streak;
}

export function longestConsistencyStreak(days: StreakDay[]): number {
  const ordered = [...days].sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  let best = 0;
  let run = 0;
  for (const day of ordered) {
    run = day.bonus ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export type DayPhase = "future" | "current" | "completed" | "partial" | "missed";

/** Past days with no perfect bonus are missed only after the day has ended. Today stays current. */
export function dayPhase(dayKey: string, todayKey: string, bonus: boolean, anyMet: boolean): DayPhase {
  if (dayKey > todayKey) return "future";
  if (dayKey === todayKey) return "current";
  if (bonus) return "completed";
  if (anyMet) return "partial";
  return "missed";
}
