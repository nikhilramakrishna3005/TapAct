import { unionIntervals } from "../sync/merge";

/** Points for meeting one activity's daily target. Extra minutes never add more. */
export const TARGET_POINTS = 20;
/** Bonus for meeting every activity target on the same calendar day. */
export const PERFECT_DAY_POINTS = 10;

export const DUEL_DURATIONS = [7, 14, 30] as const;
export type DuelDuration = (typeof DUEL_DURATIONS)[number];

export type ScoreSession = {
  activityId: string;
  startMs: number;
  endMs: number;
  /** Timer sessions count. Manual Time Rescue entries are not verified effort. */
  source?: "timer" | "manual";
  deletedAtMs?: number;
};

export type ScoreActivity = { id: string; targetMinutes: number; trackerActivityId: string | null };

/** Shared rules that apply from `effectiveOn` until a later version. */
export type RuleVersion = { effectiveOn: string; activities: ScoreActivity[] };

export type ScoreMember = {
  id: string;
  timeZone: string;
  /** Scoring stops at this instant. */
  leftAtMs?: number | null;
  activities: ScoreActivity[];
  sessions: ScoreSession[];
};

export type DayActivityScore = { id: string; minutes: number; met: boolean };
export type DayScore = { dayKey: string; points: number; bonus: boolean; activities: DayActivityScore[] };
export type MemberScore = { id: string; points: number; days: DayScore[] };

const MINUTE = 60_000;

export function isDuelDuration(value: number): value is DuelDuration {
  return (DUEL_DURATIONS as readonly number[]).includes(value);
}

/** Calendar date in an IANA time zone. Invalid zones throw. */
export function zonedDayKey(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Invalid time zone");
  }
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** UTC instant when `dayKey` begins in `timeZone`. */
export function startOfZonedDay(dayKey: string, timeZone: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  let lo = Date.UTC(year, month - 1, day - 1);
  let hi = Date.UTC(year, month - 1, day + 1, 12);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedDayKey(mid, timeZone) < dayKey) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function challengeDayKeys(startsOn: string, durationDays: number): string[] {
  return Array.from({ length: durationDays }, (_, index) => addCalendarDays(startsOn, index));
}

/**
 * Shared first scoring date. The creator's date is kept when acceptance is still
 * before that day begins in every participant's zone. Otherwise both players
 * start on the next calendar date that has not begun for either of them, so
 * time tracked before both have joined cannot score.
 */
export function officialStartDate(plannedStartsOn: string, acceptedAtMs: number, zones: string[]): string {
  if (zones.length === 0) return plannedStartsOn;
  const stillAhead = zones.every((zone) => acceptedAtMs < startOfZonedDay(plannedStartsOn, zone));
  if (stillAhead) return plannedStartsOn;
  return zones.reduce((latest, zone) => {
    const next = addCalendarDays(zonedDayKey(acceptedAtMs, zone), 1);
    return next > latest ? next : latest;
  }, "0000-00-00");
}

function splitZoned(startMs: number, endMs: number, timeZone: string): { dayKey: string; ms: number }[] {
  const spans: { dayKey: string; ms: number }[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const dayKey = zonedDayKey(cursor, timeZone);
    const next = startOfZonedDay(addCalendarDays(dayKey, 1), timeZone);
    const boundary = Math.min(endMs, Math.max(cursor + 1, next));
    spans.push({ dayKey, ms: boundary - cursor });
    cursor = boundary;
  }
  return spans;
}

/** Rules in force on a challenge day. Later versions replace earlier ones on their effective date. */
export function rulesForDay(versions: RuleVersion[], dayKey: string): ScoreActivity[] {
  const ordered = [...versions].sort((a, b) => (a.effectiveOn < b.effectiveOn ? -1 : a.effectiveOn > b.effectiveOn ? 1 : 0));
  let chosen = ordered[0]?.activities ?? [];
  for (const version of ordered) {
    if (version.effectiveOn <= dayKey) chosen = version.activities;
  }
  return chosen;
}

/**
 * First challenge day a newly approved rule may use. It is the next date that has
 * not started in any participant's saved time zone, and not before the official start.
 * Returns null when that date is after the duel.
 */
export function nextRuleDay(nowMs: number, zones: string[], startsOn: string, durationDays: number): string | null {
  if (zones.length === 0) return null;
  const tomorrow = zones.reduce((latest, zone) => {
    const next = addCalendarDays(zonedDayKey(nowMs, zone), 1);
    return next > latest ? next : latest;
  }, "0000-00-00");
  const effective = tomorrow > startsOn ? tomorrow : startsOn;
  if (effective >= addCalendarDays(startsOn, durationDays)) return null;
  return effective;
}

/**
 * Scores one participant from timer sessions only.
 * Manual or deleted sessions never count. Days are the agreed calendar dates
 * interpreted in the member's frozen time zone. Minutes above a target add no points.
 * When rule versions are passed, each day uses the targets and activity set in force that day.
 */
export function scoreMember(
  member: ScoreMember,
  startsOn: string,
  durationDays: number,
  versions?: RuleVersion[],
): MemberScore {
  const days = challengeDayKeys(startsOn, durationDays);
  const daySet = new Set(days);
  const schedule = versions && versions.length > 0 ? versions : [{ effectiveOn: startsOn, activities: member.activities }];
  const windowStart = startOfZonedDay(startsOn, member.timeZone);
  const windowEnd = startOfZonedDay(addCalendarDays(startsOn, durationDays), member.timeZone);
  const clipEnd = member.leftAtMs != null ? Math.min(windowEnd, member.leftAtMs) : windowEnd;
  const catalog = new Map<string, ScoreActivity>();
  for (const version of schedule) {
    for (const activity of version.activities) catalog.set(activity.id, activity);
  }

  const minutes = new Map<string, number>();
  for (const activity of catalog.values()) {
    if (!activity.trackerActivityId) continue;
    const intervals = member.sessions
      .filter(
        (session) =>
          session.activityId === activity.trackerActivityId &&
          session.deletedAtMs == null &&
          session.source !== "manual" &&
          session.endMs > session.startMs,
      )
      .map((session) => ({
        startMs: Math.max(session.startMs, windowStart),
        endMs: Math.min(session.endMs, clipEnd),
      }));
    for (const interval of unionIntervals(intervals)) {
      for (const span of splitZoned(interval.startMs, interval.endMs, member.timeZone)) {
        if (!daySet.has(span.dayKey)) continue;
        const key = `${span.dayKey}|${activity.id}`;
        minutes.set(key, (minutes.get(key) ?? 0) + span.ms);
      }
    }
  }

  let points = 0;
  const dayScores = days.map((dayKey): DayScore => {
    const dayActivities = rulesForDay(schedule, dayKey);
    let metCount = 0;
    const activities = dayActivities.map((activity): DayActivityScore => {
      const tracked = Math.floor((minutes.get(`${dayKey}|${activity.id}`) ?? 0) / MINUTE);
      const met = activity.trackerActivityId != null && tracked >= activity.targetMinutes;
      if (met) metCount += 1;
      return { id: activity.id, minutes: tracked, met };
    });
    const bonus = dayActivities.length > 0 && metCount === dayActivities.length;
    const dayPoints = metCount * TARGET_POINTS + (bonus ? PERFECT_DAY_POINTS : 0);
    points += dayPoints;
    return { dayKey, points: dayPoints, bonus, activities };
  });

  return { id: member.id, points, days: dayScores };
}

export function compareScores(a: number, b: number): "a" | "b" | "tie" {
  if (a === b) return "tie";
  return a > b ? "a" : "b";
}

export function duelIsFinal(nowMs: number, startsOn: string, durationDays: number, zones: string[]): boolean {
  if (zones.length < 2) return false;
  const endDay = addCalendarDays(startsOn, durationDays);
  return zones.every((zone) => nowMs >= startOfZonedDay(endDay, zone));
}
