import { shiftDayKey } from "./insights";
import { type Activity, type DailyRecords, LIFE_CATEGORY_IDS, type LifeCategoryId, MS_PER_MINUTE } from "./tracker";

export type LifeAreaId = LifeCategoryId | "unassigned";

export const LIFE_AREAS: { id: LifeAreaId; label: string; color: string }[] = [
  { id: "work", label: "Work", color: "#8E7BFF" },
  { id: "health", label: "Health", color: "#6CF2C2" },
  { id: "learning", label: "Learning", color: "#5FE3FF" },
  { id: "relationships", label: "Relationships", color: "#FF7AB6" },
  { id: "rest", label: "Rest", color: "#FFC46B" },
  { id: "unassigned", label: "Unassigned", color: "#8A8FA3" },
];

const AREA_BY_ID = new Map(LIFE_AREAS.map((area) => [area.id, area]));

export function getLifeArea(id: LifeAreaId) {
  return AREA_BY_ID.get(id)!;
}

export function areaOf(activity: Pick<Activity, "category">): LifeAreaId {
  return activity.category ?? "unassigned";
}

export type BalancePeriod = "today" | "7d" | "30d";

export const PERIOD_DAYS: Record<BalancePeriod, number> = { today: 1, "7d": 7, "30d": 30 };

export type PeriodRange = { startKey: string; endKey: string; previousStartKey: string; previousEndKey: string; days: number };

/** The period ending today, and the equally long period right before it. */
export function getPeriodRange(todayKey: string, period: BalancePeriod): PeriodRange {
  const days = PERIOD_DAYS[period];
  const startKey = shiftDayKey(todayKey, -(days - 1));
  return {
    startKey,
    endKey: todayKey,
    previousStartKey: shiftDayKey(startKey, -days),
    previousEndKey: shiftDayKey(startKey, -1),
    days,
  };
}

export type AreaActivity = { activity: Activity; ms: number; previousMs: number };

export type AreaSummary = {
  id: LifeAreaId;
  label: string;
  color: string;
  ms: number;
  previousMs: number;
  /** Share of all tracked time in the period (0–1). */
  share: number;
  activities: AreaActivity[];
};

export type LifeBalance = {
  period: BalancePeriod;
  range: PeriodRange;
  totalMs: number;
  previousTotalMs: number;
  /** Every area, in the fixed display order. */
  areas: AreaSummary[];
  trackedDays: number;
};

function sumByActivity(records: DailyRecords, startKey: string, endKey: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [dayKey, day] of Object.entries(records)) {
    if (dayKey < startKey || dayKey > endKey) continue;
    for (const [activityId, ms] of Object.entries(day)) {
      if (ms > 0) totals.set(activityId, (totals.get(activityId) ?? 0) + ms);
    }
  }
  return totals;
}

/**
 * Tracked time per life area. Only recorded totals are used (they already reflect
 * session edits and deletions); untracked time is never attributed to any area.
 * Activities are grouped by their current area, archived ones included.
 */
export function computeLifeBalance(
  records: DailyRecords,
  activities: Activity[],
  todayKey: string,
  period: BalancePeriod,
): LifeBalance {
  const range = getPeriodRange(todayKey, period);
  const current = sumByActivity(records, range.startKey, range.endKey);
  const previous = sumByActivity(records, range.previousStartKey, range.previousEndKey);

  const byArea = new Map<LifeAreaId, AreaActivity[]>(LIFE_AREAS.map((area) => [area.id, []]));
  for (const activity of activities) {
    const ms = current.get(activity.id) ?? 0;
    const previousMs = previous.get(activity.id) ?? 0;
    if (ms > 0 || previousMs > 0) {
      byArea.get(areaOf(activity))!.push({ activity, ms, previousMs });
    }
  }

  const sum = (items: AreaActivity[], key: "ms" | "previousMs") => items.reduce((total, item) => total + item[key], 0);
  const totalMs = [...byArea.values()].reduce((total, items) => total + sum(items, "ms"), 0);
  const previousTotalMs = [...byArea.values()].reduce((total, items) => total + sum(items, "previousMs"), 0);

  const areas = LIFE_AREAS.map((area): AreaSummary => {
    const items = byArea.get(area.id)!.sort((a, b) => b.ms - a.ms || b.previousMs - a.previousMs);
    const ms = sum(items, "ms");
    return { ...area, ms, previousMs: sum(items, "previousMs"), share: totalMs > 0 ? ms / totalMs : 0, activities: items };
  });

  let trackedDays = 0;
  for (let offset = 0; offset < range.days; offset += 1) {
    const day = records[shiftDayKey(range.endKey, -offset)];
    if (day && Object.values(day).some((ms) => ms > 0)) trackedDays += 1;
  }

  return { period, range, totalMs, previousTotalMs, areas, trackedDays };
}

export function formatShare(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

export function formatBalanceDuration(ms: number): string {
  const minutes = Math.round(ms / MS_PER_MINUTE);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export const COMPARISON_LABEL: Record<BalancePeriod, string> = {
  today: "yesterday",
  "7d": "the previous 7 days",
  "30d": "the previous 30 days",
};

const PERIOD_PHRASE: Record<BalancePeriod, string> = {
  today: "today",
  "7d": "over the last 7 days",
  "30d": "over the last 30 days",
};

/** Changes smaller than this aren't worth pointing out. */
const NOTABLE_CHANGE_MS = 15 * MS_PER_MINUTE;

function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Factual, neutral notes drawn only from recorded time. */
export function getObservations(balance: LifeBalance): string[] {
  if (balance.totalMs === 0) return [];
  const notes: string[] = [];
  const phrase = PERIOD_PHRASE[balance.period];
  const tracked = balance.areas.filter((area) => area.ms > 0).sort((a, b) => b.ms - a.ms);

  const top = tracked[0];
  if (top) {
    const name = top.id === "unassigned" ? "Unassigned activities" : top.label;
    notes.push(
      tracked.length === 1
        ? `All of your tracked time ${phrase} was in ${top.id === "unassigned" ? "unassigned activities" : top.label}.`
        : `${name} made up ${formatShare(top.share)} of your tracked time ${phrase}.`,
    );
  }

  if (balance.previousTotalMs > 0) {
    const change = balance.areas
      .map((area) => ({ area, delta: area.ms - area.previousMs }))
      .filter(({ delta }) => Math.abs(delta) >= NOTABLE_CHANGE_MS)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (change) {
      const name = change.area.id === "unassigned" ? "Unassigned time" : `${change.area.label} time`;
      notes.push(
        `${name} was ${change.delta > 0 ? "up" : "down"} ${formatBalanceDuration(Math.abs(change.delta))} compared with ${COMPARISON_LABEL[balance.period]}.`,
      );
    }
  }

  const unassigned = balance.areas.find((area) => area.id === "unassigned");
  if (unassigned && unassigned.ms > 0) {
    const count = unassigned.activities.filter((item) => item.ms > 0).length;
    notes.push(
      `${count} ${count === 1 ? "activity" : "activities"} with ${formatBalanceDuration(unassigned.ms)} ${count === 1 ? "isn't" : "aren't"} assigned to a life area yet.`,
    );
  }

  if (balance.range.days > 1) {
    notes.push(`You tracked time on ${balance.trackedDays} of the last ${balance.range.days} days.`);
  }

  const empty = balance.areas.filter((area) => area.id !== "unassigned" && area.ms === 0).map((area) => area.label);
  if (empty.length > 0 && empty.length < LIFE_CATEGORY_IDS.length) {
    notes.push(`No time was tracked for ${listLabels(empty)} ${phrase}.`);
  }

  return notes.slice(0, 4);
}
