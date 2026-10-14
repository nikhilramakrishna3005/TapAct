"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  Download,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_DAY_SECONDS,
  cursorFromProgress,
  formatReplayClock,
  formatReplayDuration,
  getDayRecap,
  getPlayheadLimit,
  getReplayFrame,
  getReplayMode,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  progressFromCursor,
  untimedLabel,
} from "@/lib/dayReplay";
import { formatShare } from "@/lib/lifeBalance";
import { parseDayKey } from "@/lib/insights";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { runningSegment } from "@/lib/sync/merge";
import { buildDayTimeline, getHourMarks, loadRecordedSegments } from "@/lib/timeline";
import type { TrackerState } from "@/lib/tracker";
import { useMotionPrefs } from "./MotionPrefs";
import { downloadDayRecapCard } from "./downloadRecap";
import { OrbitMark } from "./Orbit";
import { formatSummaryDuration, ICON_REGISTRY, tint } from "./ui";

const SIZE = 276;
const CENTER = SIZE / 2;
const RING_R = 108;
const LANE_GAP = 15;

function polar(ratio: number, radius: number) {
  const angle = ratio * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function arcPath(radius: number, start: number, end: number): string {
  const sweep = Math.max(end - start, 0.0008);
  const from = polar(start, radius);
  const to = polar(start + sweep, radius);
  const large = sweep > 0.5 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
}

function describeDay(dayKey: string, todayKey: string): string {
  const date = parseDayKey(dayKey);
  if (dayKey === todayKey) return "Today";
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function dateLabel(dayKey: string): string {
  return parseDayKey(dayKey).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function shareDateLabel(dayKey: string): string {
  return parseDayKey(dayKey).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function DayReplay({
  tracker,
  dayKey,
  todayKey,
  nowMs,
  onClose,
}: {
  tracker: TrackerState;
  dayKey: string;
  todayKey: string;
  nowMs: number;
  onClose: () => void;
}) {
  const { reduced } = useMotionPrefs();
  const recorded = useMemo(() => loadRecordedSegments(getStorage()), [tracker.revision]);
  const timeline = useMemo(() => {
    const live = recorded.owned ? runningSegment(tracker, recorded.deviceId, recorded.floor) : null;
    return buildDayTimeline({
      dayKey,
      entries: recorded.entries,
      activities: tracker.activities,
      dailyRecords: tracker.dailyRecords,
      live,
    });
  }, [dayKey, recorded, tracker]);

  const mode = getReplayMode(timeline);
  const limitMs = getPlayheadLimit(timeline, nowMs);
  const maxProgress = progressFromCursor(timeline, limitMs);
  const recap = useMemo(() => getDayRecap(timeline), [timeline]);
  const hourMarks = useMemo(() => getHourMarks(dayKey), [dayKey]);
  const dayLength = timeline.endMs - timeline.startMs;
  const ratioOf = (ms: number) => (dayLength <= 0 ? 0 : (ms - timeline.startMs) / dayLength);

  const [progress, setProgress] = useState(() => (reduced || mode !== "timed" ? maxProgress : 0));
  const [playing, setPlaying] = useState(() => !reduced && mode === "timed");
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [shareError, setShareError] = useState<string | null>(null);
  const scrubbing = useRef(false);

  const frame = useMemo(() => getReplayFrame(timeline, cursorFromProgress(timeline, progress), limitMs), [limitMs, progress, timeline]);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const playhead = polar(frame.progress, RING_R);
  const showRecap = mode !== "timed" || frame.finished || reduced;

  const setClampedProgress = useCallback(
    (next: number) => {
      setProgress(Math.min(maxProgress, Math.max(0, next)));
    },
    [maxProgress],
  );

  useEffect(() => {
    if (!playing || reduced || mode !== "timed" || scrubbing.current) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((current) => {
        const next = current + (dt * speed) / BASE_DAY_SECONDS;
        if (next >= maxProgress) {
          setPlaying(false);
          return maxProgress;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [maxProgress, mode, playing, reduced, speed]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === " " && mode === "timed" && !reduced) {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key === "Home" || event.key === "r") {
        event.preventDefault();
        setClampedProgress(0);
        setPlaying(!reduced && mode === "timed");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setClampedProgress(progressFromCursor(timeline, frameRef.current.cursorMs + 15 * 60_000));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPlaying(false);
        setClampedProgress(progressFromCursor(timeline, frameRef.current.cursorMs - 15 * 60_000));
      } else if (event.key === "1" || event.key === "2" || event.key === "4") {
        setSpeed(Number(event.key) as PlaybackSpeed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mode, onClose, reduced, setClampedProgress, timeline]);

  const restart = () => {
    setClampedProgress(0);
    setPlaying(!reduced && mode === "timed");
    setShareError(null);
  };

  const share = () => {
    const ok = downloadDayRecapCard(recap, shareDateLabel(dayKey));
    setShareError(ok ? null : "Couldn't save the recap image.");
  };

  const primary = frame.primary;
  const PrimaryIcon = primary ? ICON_REGISTRY[primary.activity.iconKey].icon : null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Day replay for ${dateLabel(dayKey)}`}
      className="fixed inset-0 z-40 flex flex-col bg-ink-0 text-text-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.quick }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 18%, rgba(142,123,255,0.16), transparent 58%), radial-gradient(70% 40% at 50% 100%, rgba(95,227,255,0.08), transparent 55%)",
        }}
      />

      <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-[calc(0.7rem+env(safe-area-inset-top))]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <OrbitMark size={18} spin={playing && !reduced} />
            <p className="eyebrow">Day Replay</p>
          </div>
          <h2 className="display mt-1 truncate text-[1.45rem]">{describeDay(dayKey, todayKey)}</h2>
          <p className="text-xs text-text-3">{dateLabel(dayKey)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close day replay"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-ink-1 text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-[calc(1.1rem+env(safe-area-inset-bottom))]">
        {mode === "empty" ? (
          <p className="mt-16 text-center text-sm text-text-3">Nothing was tracked this day.</p>
        ) : mode === "totals-only" ? (
          <div className="mx-auto mt-8 max-w-[366px] text-center">
            <OrbitMark size={42} />
            <p className="mt-4 text-base font-semibold text-text-1">Totals only</p>
            <p className="mt-2 text-sm leading-relaxed text-text-3">{untimedLabel(timeline.untimed)}</p>
          </div>
        ) : (
          <>
            <div className="relative mx-auto mt-3" style={{ width: SIZE, height: SIZE }}>
              <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="overflow-visible">
                <circle cx={CENTER} cy={CENTER} r={RING_R} fill="none" stroke="var(--orbit-dim)" strokeWidth={16} />
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={RING_R - 22}
                  fill="none"
                  stroke="var(--orbit-dim)"
                  strokeDasharray="2 6"
                />
                {hourMarks
                  .filter((mark) => mark.hour % 6 === 0 && mark.hour < 24)
                  .map((mark) => {
                    const outer = polar(mark.ratio, RING_R + 16);
                    const inner = polar(mark.ratio, RING_R + 8);
                    return (
                      <line
                        key={mark.hour}
                        x1={inner.x}
                        y1={inner.y}
                        x2={outer.x}
                        y2={outer.y}
                        stroke="var(--tick)"
                        strokeWidth={1.5}
                      />
                    );
                  })}
                {timeline.sessions.map((session) => {
                  const start = ratioOf(session.dayStartMs);
                  const end = ratioOf(session.dayEndMs);
                  const shownEnd = Math.min(end, Math.max(start, frame.progress));
                  const revealed = frame.progress > start;
                  const radius = RING_R - session.lane * LANE_GAP;
                  const active = frame.active.some((item) => item.id === session.id);
                  if (!revealed) {
                    return (
                      <path
                        key={`${session.id}-hint`}
                        d={arcPath(radius, start, end)}
                        fill="none"
                        stroke={session.activity.color}
                        strokeWidth={timeline.laneCount > 1 ? 8 : 12}
                        strokeLinecap="round"
                        opacity={0.12}
                      />
                    );
                  }
                  return (
                    <path
                      key={session.id}
                      d={arcPath(radius, start, shownEnd)}
                      fill="none"
                      stroke={session.activity.color}
                      strokeWidth={active ? 14 : timeline.laneCount > 1 ? 9 : 12}
                      strokeLinecap="round"
                      opacity={active ? 1 : 0.82}
                      style={{ filter: active ? `drop-shadow(0 0 10px ${tint(session.activity.color, 0.7)})` : undefined }}
                    />
                  );
                })}
                <circle cx={playhead.x} cy={playhead.y} r={11} fill={primary?.activity.color ?? "var(--ice)"} opacity={0.22} className={playing ? "ambient-breathe" : undefined} />
                <circle
                  cx={playhead.x}
                  cy={playhead.y}
                  r={6}
                  fill={primary?.activity.color ?? "var(--ice)"}
                  stroke="var(--ink-0)"
                  strokeWidth={2.5}
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div className="max-w-[128px]">
                  <p className="numeric text-[1.7rem] font-semibold leading-none text-text-1">{formatReplayClock(frame.cursorMs)}</p>
                  <p className="numeric mt-1 text-xs text-text-3">{formatReplayDuration(frame.trackedMs)} tracked</p>
                </div>
              </div>
            </div>

            <div
              className="mx-auto mt-4 w-full max-w-[366px] rounded-[20px] border px-4 py-3.5"
              style={{
                borderColor: primary ? tint(primary.activity.color, 0.38) : "var(--line)",
                background: primary
                  ? `linear-gradient(135deg, ${tint(primary.activity.color, 0.16)}, rgba(13,13,19,0.9) 72%)`
                  : "var(--ink-1)",
              }}
              aria-live="polite"
            >
              {primary && PrimaryIcon ? (
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-xl"
                    style={{ color: primary.activity.color, background: tint(primary.activity.color, 0.16) }}
                  >
                    <PrimaryIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-base font-semibold text-text-1">
                      <span className="truncate">{primary.activity.name}</span>
                      {primary.activity.archivedAtMs !== null && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-line-strong px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.12em] text-text-3">
                          <Archive className="size-2.5" />
                          Archived
                        </span>
                      )}
                    </p>
                    <p className="numeric text-xs text-text-3">
                      {formatReplayClock(primary.dayStartMs)} – {primary.live ? "Now" : formatReplayClock(primary.dayEndMs)}
                      {" · "}
                      {formatReplayDuration(Math.min(frame.cursorMs, primary.dayEndMs) - primary.dayStartMs)}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-text-1">{frame.finished ? "End of day" : "Untracked"}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-3">
                    {frame.finished
                      ? "Replay reached the end of recorded time."
                      : "No recorded session at this time. Untracked time isn't counted as Rest."}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {mode === "timed" && (
          <div className="mx-auto mt-5 w-full max-w-[366px]">
            <label className="block">
              <span className="sr-only">Scrub through the day</span>
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Math.round(frame.progress * 1000)}
                aria-valuetext={formatReplayClock(frame.cursorMs)}
                onPointerDown={() => {
                  scrubbing.current = true;
                  setPlaying(false);
                }}
                onPointerUp={() => {
                  scrubbing.current = false;
                }}
                onChange={(event) => setClampedProgress(Number(event.target.value) / 1000)}
                className="h-8 w-full cursor-pointer appearance-none bg-transparent accent-[var(--volt)] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--track)] [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ice"
              />
            </label>
            <div className="mt-1 flex justify-between text-[0.6rem] font-medium text-text-3">
              <span>12 AM</span>
              <span>12 PM</span>
              <span>12 AM</span>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={restart}
                aria-label="Restart replay"
                className="grid size-11 place-items-center rounded-full border border-line-strong bg-ink-1 text-text-1 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
                disabled={reduced}
                aria-label={playing ? "Pause replay" : "Play replay"}
                className="grid size-14 place-items-center rounded-full bg-text-1 text-ink-0 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
              >
                {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
              </button>
              <div role="group" aria-label="Playback speed" className="flex rounded-full border border-line-strong bg-ink-1 p-1">
                {PLAYBACK_SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={speed === value}
                    onClick={() => setSpeed(value)}
                    className={`min-h-9 min-w-10 rounded-full px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi ${
                      speed === value ? "bg-volt text-ink-0" : "text-text-2"
                    }`}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
            {reduced && (
              <p className="mt-3 text-center text-xs text-text-3">Motion is reduced, so the day is shown all at once. Use the scrubber to inspect a time.</p>
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {showRecap && recap.totalMs > 0 && (
            <motion.section
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              className="mx-auto mt-6 w-full max-w-[366px] rounded-[22px] border border-line bg-ink-1 px-4 py-4"
              aria-label="Day recap"
            >
              <p className="eyebrow">Recap</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <RecapStat label="Tracked" value={formatSummaryDuration(recap.totalMs)} />
                <RecapStat label="Activities" value={String(recap.activityCount)} />
                <RecapStat label="Longest" value={recap.longestMs > 0 ? formatReplayDuration(recap.longestMs) : "—"} />
              </div>
              {recap.areas.length > 0 && (
                <ul className="mt-4 space-y-2" aria-label="Life areas">
                  {recap.areas.map((area) => (
                    <li key={area.id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2 text-text-1">
                          <span className="size-2 rounded-full" style={{ background: area.color }} aria-hidden="true" />
                          {area.label}
                        </span>
                        <span className="numeric text-text-2">
                          {formatReplayDuration(area.ms)}
                          <span className="ml-2 text-xs text-text-3">{formatShare(area.share)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--track-soft)]">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(area.share * 100, 2)}%`, background: area.color }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {recap.untimedMs > 0 && mode === "timed" && (
                <p className="mt-3 text-xs text-text-3">
                  Includes {formatReplayDuration(recap.untimedMs)} recorded as totals only.
                </p>
              )}
              <button type="button" onClick={share} className="btn btn-ghost mt-4 h-12 w-full">
                <Download className="size-4" />
                Save recap card
              </button>
              <p className="mt-2 text-center text-[0.68rem] leading-relaxed text-text-3">
                The card has totals and life areas only — no account, clocks, or activity names.
              </p>
              {shareError && (
                <p role="alert" className="mt-2 text-center text-xs text-danger">
                  {shareError}
                </p>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function RecapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-[var(--wash)] px-2 py-2 text-center">
      <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-text-3">{label}</p>
      <p className="numeric mt-1 text-sm font-semibold text-text-1">{value}</p>
    </div>
  );
}
