import { parseDayKey, shiftDayKey } from "./insights";
import { mergeEntryLists, type SessionFloor, unionIntervals, type TimeEntry } from "./sync/merge";
import { getOutbox, loadSyncCache, loadSyncMeta, SYNC_META_KEY } from "./sync/state";
import type { Activity, DailyRecords } from "./tracker";
import type { WritableStorageLike } from "./trackerStore";

export type RecordedSegments = {
  /** False for guest data, which keeps per-day totals only. */
  owned: boolean;
  deviceId: string;
  floor: SessionFloor;
  entries: TimeEntry[];
};

const NO_SEGMENTS: RecordedSegments = { owned: false, deviceId: "", floor: null, entries: [] };

/**
 * Timer segments recorded for the account that owns this device's tracker data:
 * everything pulled from the cloud plus segments not uploaded yet. Read-only.
 */
export function loadRecordedSegments(storage: WritableStorageLike | null): RecordedSegments {
  try {
    if (!storage?.getItem(SYNC_META_KEY)) return NO_SEGMENTS;
    const meta = loadSyncMeta(storage);
    if (!meta.owner) return NO_SEGMENTS;
    const cache = loadSyncCache(storage, meta.owner.userId);
    return {
      owned: true,
      deviceId: meta.deviceId,
      floor: meta.floor,
      entries: mergeEntryLists(cache.snapshot.entries, getOutbox(meta, meta.owner.userId).entries),
    };
  } catch {
    return NO_SEGMENTS;
  }
}

/** A recorded session of one activity, clipped to the visible day. */
export type TimelineSession = {
  id: string;
  activity: Activity;
  /** Recorded start and end of the whole session (may fall on another day). */
  startMs: number;
  endMs: number;
  /** The portion that falls on this day. */
  dayStartMs: number;
  dayEndMs: number;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
  live: boolean;
  /** Row on the track; sessions only share a row when they don't overlap. */
  lane: number;
};

/** Time recorded for the day as a total only (no session timestamps exist for it). */
export type UntimedTotal = { activity: Activity; ms: number };

export type DayTimeline = {
  dayKey: string;
  startMs: number;
  endMs: number;
  sessions: TimelineSession[];
  laneCount: number;
  untimed: UntimedTotal[];
};

/** Ignore sub-second leftovers between totals and sessions. */
const UNTIMED_MIN_MS = 1000;

/** Local midnight to the next local midnight (23 or 25 hours on DST change days). */
export function getDayBounds(dayKey: string): { startMs: number; endMs: number } {
  return {
    startMs: parseDayKey(dayKey).getTime(),
    endMs: parseDayKey(shiftDayKey(dayKey, 1)).getTime(),
  };
}

/** Each local clock hour of the day, positioned as a 0–1 offset along the day. */
export function getHourMarks(dayKey: string): { hour: number; ratio: number; ms: number }[] {
  const { startMs, endMs } = getDayBounds(dayKey);
  const length = endMs - startMs;
  const marks: { hour: number; ratio: number; ms: number }[] = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    const date = parseDayKey(dayKey);
    date.setHours(hour, 0, 0, 0);
    const ms = Math.min(endMs, date.getTime());
    marks.push({ hour, ms, ratio: (ms - startMs) / length });
  }
  return marks;
}

function assignLanes(sessions: Omit<TimelineSession, "lane">[]): { sessions: TimelineSession[]; laneCount: number } {
  const laneEnds: number[] = [];
  const placed = sessions.map((session) => {
    let lane = laneEnds.findIndex((end) => end <= session.dayStartMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(session.dayEndMs);
    } else {
      laneEnds[lane] = session.dayEndMs;
    }
    return { ...session, lane };
  });
  return { sessions: placed, laneCount: Math.max(1, laneEnds.length) };
}

/**
 * Builds one day's timeline from recorded timer segments only. Segments of the same
 * activity are unioned (as the daily totals are), so time from two devices is shown
 * once. Whatever part of the day's recorded total isn't covered by a segment (e.g.
 * history imported as daily totals) is returned as `untimed` instead of being placed
 * at invented times.
 */
export function buildDayTimeline({
  dayKey,
  entries,
  activities,
  dailyRecords,
  live,
}: {
  dayKey: string;
  entries: TimeEntry[];
  activities: Activity[];
  dailyRecords: DailyRecords;
  /** The running session's segment, if any; it is merged in and marked live. */
  live: TimeEntry | null;
}): DayTimeline {
  const { startMs, endMs } = getDayBounds(dayKey);
  const byId = new Map(activities.map((activity) => [activity.id, activity]));

  const byActivity = new Map<string, TimeEntry[]>();
  for (const entry of live ? [...entries, live] : entries) {
    if (!byId.has(entry.activityId) || entry.endMs <= startMs || entry.startMs >= endMs) continue;
    const list = byActivity.get(entry.activityId) ?? [];
    list.push(entry);
    byActivity.set(entry.activityId, list);
  }

  const timedByActivity = new Map<string, number>();
  const unplaced: Omit<TimelineSession, "lane">[] = [];
  for (const [activityId, list] of byActivity) {
    const activity = byId.get(activityId)!;
    for (const interval of unionIntervals(list)) {
      const dayStartMs = Math.max(interval.startMs, startMs);
      const dayEndMs = Math.min(interval.endMs, endMs);
      if (dayEndMs <= dayStartMs) continue;
      timedByActivity.set(activityId, (timedByActivity.get(activityId) ?? 0) + (dayEndMs - dayStartMs));
      unplaced.push({
        id: `${activityId}:${interval.startMs}`,
        activity,
        startMs: interval.startMs,
        endMs: interval.endMs,
        dayStartMs,
        dayEndMs,
        continuesFromPreviousDay: interval.startMs < startMs,
        continuesIntoNextDay: interval.endMs > endMs,
        live:
          live !== null &&
          live.activityId === activityId &&
          interval.startMs <= live.startMs &&
          interval.endMs === live.endMs,
      });
    }
  }
  unplaced.sort((a, b) => a.dayStartMs - b.dayStartMs || a.dayEndMs - b.dayEndMs || a.id.localeCompare(b.id));
  const { sessions, laneCount } = assignLanes(unplaced);

  const untimed: UntimedTotal[] = [];
  for (const [activityId, totalMs] of Object.entries(dailyRecords[dayKey] ?? {})) {
    const activity = byId.get(activityId);
    const remainder = totalMs - (timedByActivity.get(activityId) ?? 0);
    if (activity && remainder >= UNTIMED_MIN_MS) {
      untimed.push({ activity, ms: remainder });
    }
  }
  untimed.sort((a, b) => b.ms - a.ms);

  return { dayKey, startMs, endMs, sessions, laneCount, untimed };
}
