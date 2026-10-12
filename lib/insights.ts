import { getDayKeyForDate, MS_PER_MINUTE, type Activity, type DailyRecords } from "./tracker";

export type ActivityShare = {
  activity: Activity;
  ms: number;
  share: number;
};

export type DayBar = {
  dayKey: string;
  date: Date;
  totalMs: number;
  segments: { activity: Activity; ms: number }[];
};

export type GoalMetrics = {
  todayMet: number;
  todayTotal: number;
  weekHitRate: number;
  weekHits: number;
  weekPossible: number;
  perfectDays: number;
  perfectStreak: number;
};

export function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function shiftDayKey(dayKey: string, deltaDays: number): string {
  const date = parseDayKey(dayKey);
  date.setDate(date.getDate() + deltaDays);
  return getDayKeyForDate(date);
}

export function getDayTotal(records: DailyRecords, dayKey: string): number {
  const day = records[dayKey];
  if (!day) {
    return 0;
  }
  return Object.values(day).reduce((sum, ms) => sum + Math.max(0, ms), 0);
}

/** Inclusive list of day keys from start to end, stepping by calendar day (DST-safe). */
export function getDayKeysInRange(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  if (startKey > endKey) {
    return keys;
  }
  let cursor = startKey;
  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = shiftDayKey(cursor, 1);
  }
  return keys;
}

/** Monday-based week containing the given day. */
export function getWeekStartKey(dayKey: string): string {
  const date = parseDayKey(dayKey);
  const offset = (date.getDay() + 6) % 7;
  return shiftDayKey(dayKey, -offset);
}

export function getMonthStartKey(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`;
}

export function sumRange(records: DailyRecords, startKey: string, endKey: string): number {
  let total = 0;
  for (const [dayKey, day] of Object.entries(records)) {
    if (dayKey < startKey || dayKey > endKey) {
      continue;
    }
    for (const ms of Object.values(day)) {
      total += Math.max(0, ms);
    }
  }
  return total;
}

export function getBreakdown(
  records: DailyRecords,
  activities: Activity[],
  startKey: string,
  endKey: string,
): ActivityShare[] {
  const byId = new Map<string, number>();
  for (const [dayKey, day] of Object.entries(records)) {
    if (dayKey < startKey || dayKey > endKey) {
      continue;
    }
    for (const [activityId, ms] of Object.entries(day)) {
      byId.set(activityId, (byId.get(activityId) ?? 0) + Math.max(0, ms));
    }
  }
  const total = [...byId.values()].reduce((sum, ms) => sum + ms, 0);
  return activities
    .map((activity) => {
      const ms = byId.get(activity.id) ?? 0;
      return { activity, ms, share: total > 0 ? ms / total : 0 };
    })
    .filter((entry) => entry.ms > 0)
    .sort((a, b) => b.ms - a.ms);
}

export function getLastNDays(
  records: DailyRecords,
  activities: Activity[],
  endKey: string,
  days: number,
): DayBar[] {
  const keys = getDayKeysInRange(shiftDayKey(endKey, -(days - 1)), endKey);
  return keys.map((dayKey) => {
    const day = records[dayKey] ?? {};
    const segments = activities
      .map((activity) => ({ activity, ms: Math.max(0, day[activity.id] ?? 0) }))
      .filter((segment) => segment.ms > 0);
    return {
      dayKey,
      date: parseDayKey(dayKey),
      totalMs: segments.reduce((sum, segment) => sum + segment.ms, 0),
      segments,
    };
  });
}

function goalActivities(activities: Activity[]): Activity[] {
  return activities.filter(
    (activity) => activity.archivedAtMs === null && activity.goalMinutes !== null && activity.goalMinutes > 0,
  );
}

export function countGoalsMet(
  records: DailyRecords,
  activities: Activity[],
  dayKey: string,
): { met: number; total: number } {
  const withGoals = goalActivities(activities);
  const day = records[dayKey] ?? {};
  const met = withGoals.filter(
    (activity) => (day[activity.id] ?? 0) >= (activity.goalMinutes ?? 0) * MS_PER_MINUTE,
  ).length;
  return { met, total: withGoals.length };
}

/** Uses current goals for active activities; goals are not versioned historically. */
export function getGoalMetrics(
  records: DailyRecords,
  activities: Activity[],
  todayKey: string,
): GoalMetrics {
  const today = countGoalsMet(records, activities, todayKey);
  const weekKeys = getDayKeysInRange(shiftDayKey(todayKey, -6), todayKey);

  let weekHits = 0;
  let perfectDays = 0;
  for (const dayKey of weekKeys) {
    const { met, total } = countGoalsMet(records, activities, dayKey);
    weekHits += met;
    if (total > 0 && met === total) {
      perfectDays += 1;
    }
  }
  const weekPossible = today.total * weekKeys.length;

  let perfectStreak = 0;
  if (today.total > 0) {
    let cursor = todayKey;
    const todayPerfect = today.met === today.total;
    if (!todayPerfect) {
      cursor = shiftDayKey(todayKey, -1);
    }
    for (let i = 0; i < 366; i += 1) {
      const { met, total } = countGoalsMet(records, activities, cursor);
      if (met !== total) {
        break;
      }
      perfectStreak += 1;
      cursor = shiftDayKey(cursor, -1);
    }
  }

  return {
    todayMet: today.met,
    todayTotal: today.total,
    weekHitRate: weekPossible > 0 ? weekHits / weekPossible : 0,
    weekHits,
    weekPossible,
    perfectDays,
    perfectStreak,
  };
}

/** Day keys with any recorded time, newest first. */
export function getRecordedDayKeys(records: DailyRecords): string[] {
  return Object.keys(records)
    .filter((dayKey) => getDayTotal(records, dayKey) > 0)
    .sort((a, b) => (a < b ? 1 : -1));
}
