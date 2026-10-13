import { areaOf, formatBalanceDuration, formatShare, LIFE_AREAS, type LifeAreaId } from "./lifeBalance";
import type { DayTimeline, TimelineSession, UntimedTotal } from "./timeline";

export const PLAYBACK_SPEEDS = [1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Wall-clock seconds to traverse a full 24-hour day at 1× (1 second per hour). */
export const BASE_DAY_SECONDS = 24;

export type ReplayMode = "timed" | "totals-only" | "empty";

export function getReplayMode(timeline: DayTimeline): ReplayMode {
  if (timeline.sessions.length > 0) return "timed";
  if (timeline.untimed.length > 0) return "totals-only";
  return "empty";
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

export function progressFromCursor(timeline: DayTimeline, cursorMs: number): number {
  const length = timeline.endMs - timeline.startMs;
  if (length <= 0) return 0;
  return clampProgress((cursorMs - timeline.startMs) / length);
}

export function cursorFromProgress(timeline: DayTimeline, progress: number): number {
  const length = timeline.endMs - timeline.startMs;
  return timeline.startMs + clampProgress(progress) * length;
}

/** The latest time the playhead may reach (now on today; midnight otherwise). */
export function getPlayheadLimit(timeline: DayTimeline, nowMs: number): number {
  return Math.min(timeline.endMs, Math.max(timeline.startMs, nowMs));
}

export type ReplayFrame = {
  cursorMs: number;
  progress: number;
  /** Sessions that have started by this cursor. */
  revealed: TimelineSession[];
  /** Sessions covering the playhead right now (overlaps allowed). */
  active: TimelineSession[];
  /** The latest-started active session, or null in a gap. */
  primary: TimelineSession | null;
  trackedMs: number;
  inGap: boolean;
  finished: boolean;
};

function trackedThrough(session: TimelineSession, cursorMs: number): number {
  return Math.max(0, Math.min(session.dayEndMs, cursorMs) - session.dayStartMs);
}

/**
 * What the replay should show at `cursorMs`. Only recorded session timestamps are
 * used; untimed totals never appear on the playhead.
 */
export function getReplayFrame(timeline: DayTimeline, cursorMs: number, limitMs = timeline.endMs): ReplayFrame {
  const cap = Math.min(Math.max(cursorMs, timeline.startMs), limitMs);
  const revealed = timeline.sessions.filter((session) => session.dayStartMs < cap);
  const active = revealed
    .filter((session) => session.dayStartMs <= cap && cap < session.dayEndMs)
    .sort((a, b) => b.dayStartMs - a.dayStartMs || a.id.localeCompare(b.id));
  const trackedMs = timeline.sessions.reduce((sum, session) => sum + trackedThrough(session, cap), 0);
  const finished = cap >= limitMs;
  return {
    cursorMs: cap,
    progress: progressFromCursor(timeline, cap),
    revealed,
    active,
    primary: active[0] ?? null,
    trackedMs,
    inGap: active.length === 0 && !finished,
    finished,
  };
}

export type RecapArea = { id: LifeAreaId; label: string; color: string; ms: number; share: number };

export type DayRecap = {
  dayKey: string;
  totalMs: number;
  sessionMs: number;
  untimedMs: number;
  sessionCount: number;
  activityCount: number;
  longestMs: number;
  areas: RecapArea[];
};

function addAreaMs(totals: Map<LifeAreaId, number>, items: { activity: { category: TimelineSession["activity"]["category"] }; ms: number }[]) {
  for (const item of items) {
    if (item.ms <= 0) continue;
    const id = areaOf(item.activity);
    totals.set(id, (totals.get(id) ?? 0) + item.ms);
  }
}

/** Aggregate recap for the in-app close and the share card. Names are kept off the card. */
export function getDayRecap(timeline: DayTimeline): DayRecap {
  const sessionMs = timeline.sessions.reduce((sum, session) => sum + (session.dayEndMs - session.dayStartMs), 0);
  const untimedMs = timeline.untimed.reduce((sum, item) => sum + item.ms, 0);
  const totalMs = sessionMs + untimedMs;
  const ids = new Set<string>();
  for (const session of timeline.sessions) ids.add(session.activity.id);
  for (const item of timeline.untimed) ids.add(item.activity.id);
  const longestMs = timeline.sessions.reduce((max, session) => Math.max(max, session.dayEndMs - session.dayStartMs), 0);

  const byArea = new Map<LifeAreaId, number>(LIFE_AREAS.map((area) => [area.id, 0]));
  addAreaMs(
    byArea,
    timeline.sessions.map((session) => ({ activity: session.activity, ms: session.dayEndMs - session.dayStartMs })),
  );
  addAreaMs(byArea, timeline.untimed);

  const areas = LIFE_AREAS.map((area): RecapArea => {
    const ms = byArea.get(area.id) ?? 0;
    return { ...area, ms, share: totalMs > 0 ? ms / totalMs : 0 };
  }).filter((area) => area.ms > 0);

  return {
    dayKey: timeline.dayKey,
    totalMs,
    sessionMs,
    untimedMs,
    sessionCount: timeline.sessions.length,
    activityCount: ids.size,
    longestMs,
    areas,
  };
}

export function formatReplayClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatReplayDuration(ms: number): string {
  return ms > 0 && ms < 60_000 ? "<1m" : formatBalanceDuration(ms);
}

export function shareCardLines(recap: DayRecap): { label: string; value: string }[] {
  const lines = [
    { label: "Tracked", value: formatReplayDuration(recap.totalMs) },
    { label: "Activities", value: String(recap.activityCount) },
  ];
  if (recap.longestMs > 0) {
    lines.push({ label: "Longest session", value: formatReplayDuration(recap.longestMs) });
  }
  return lines;
}

export function shareAreaCaption(areas: RecapArea[]): string {
  return areas
    .slice(0, 4)
    .map((area) => `${area.label} ${formatShare(area.share)}`)
    .join("  ·  ");
}

export function untimedLabel(items: UntimedTotal[]): string {
  if (items.length === 0) return "";
  return items.length === 1
    ? "This day was recorded as a total only, so a timed replay isn't available."
    : "This day was recorded as totals only, so a timed replay isn't available.";
}
