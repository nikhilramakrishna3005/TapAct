"use client";

import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, History, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  countGoalsMet,
  getBreakdown,
  getDayTotal,
  getRecordedDayKeys,
  parseDayKey,
  shiftDayKey,
} from "@/lib/insights";
import { MS_PER_MINUTE, type TrackerState } from "@/lib/tracker";
import { DayReplay } from "./DayReplay";
import { OrbitTimeline } from "./OrbitTimeline";
import {
  ActivityBreakdownRow,
  EmptyState,
  formatSummaryDuration,
  ScreenHeader,
  SectionCard,
  StatTile,
} from "./ui";

function describeDay(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) {
    return "Today";
  }
  if (dayKey === shiftDayKey(todayKey, -1)) {
    return "Yesterday";
  }
  return parseDayKey(dayKey).toLocaleDateString(undefined, { weekday: "long" });
}

export function HistoryView({
  tracker,
  todayKey,
  nowMs,
}: {
  tracker: TrackerState;
  todayKey: string;
  nowMs: number;
}) {
  const records = tracker.dailyRecords;
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [direction, setDirection] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const recordedKeys = useMemo(() => getRecordedDayKeys(records), [records]);
  const stripKeys = useMemo(
    () => (recordedKeys.includes(todayKey) ? recordedKeys : [todayKey, ...recordedKeys]),
    [recordedKeys, todayKey],
  );
  const earliestKey = stripKeys[stripKeys.length - 1] ?? todayKey;

  const safeSelectedKey = selectedKey > todayKey ? todayKey : selectedKey;
  const canGoBack = safeSelectedKey > earliestKey;
  const canGoForward = safeSelectedKey < todayKey;

  const selectDay = (dayKey: string) => {
    setDirection(dayKey < safeSelectedKey ? -1 : 1);
    setSelectedKey(dayKey);
  };

  useEffect(() => {
    const chip = stripRef.current?.querySelector<HTMLElement>(`[data-day="${safeSelectedKey}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [safeSelectedKey]);

  const dayTotal = getDayTotal(records, safeSelectedKey);
  const breakdown = useMemo(
    () => getBreakdown(records, tracker.activities, safeSelectedKey, safeSelectedKey),
    [records, safeSelectedKey, tracker.activities],
  );
  const goals = countGoalsMet(records, tracker.activities, safeSelectedKey);
  const selectedDate = parseDayKey(safeSelectedKey);

  return (
    <>
      <ScreenHeader eyebrow="History" title="Every day you showed up.">
        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => selectDay(shiftDayKey(safeSelectedKey, -1))}
            disabled={!canGoBack}
            aria-label="Previous day"
            className="grid size-11 place-items-center rounded-full border border-line-strong bg-ink-1 text-text-1 transition-colors hover:border-white/30 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
          >
            <ChevronLeft className="size-4" />
          </button>
          <label className="relative min-w-0 cursor-pointer rounded-2xl px-3 py-1 text-center transition-colors hover:bg-white/[0.04] focus-within:ring-2 focus-within:ring-volt-hi">
            <span className="block text-base font-semibold tracking-[-0.01em] text-text-1">
              {describeDay(safeSelectedKey, todayKey)}
            </span>
            <span className="flex items-center justify-center gap-1 text-xs text-text-3">
              {selectedDate.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              <CalendarDays aria-hidden="true" className="size-3" />
            </span>
            <input
              ref={dateInputRef}
              type="date"
              aria-label="Pick a date"
              value={safeSelectedKey}
              min={earliestKey}
              max={todayKey}
              onClick={() => {
                try {
                  dateInputRef.current?.showPicker?.();
                } catch {
                  // Some browsers only allow showPicker from certain gestures; the native control still works.
                }
              }}
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey && value >= earliestKey) {
                  selectDay(value);
                }
              }}
              className="absolute inset-0 size-full cursor-pointer opacity-0 [color-scheme:dark]"
            />
          </label>
          <button
            type="button"
            onClick={() => selectDay(shiftDayKey(safeSelectedKey, 1))}
            disabled={!canGoForward}
            aria-label="Next day"
            className="grid size-11 place-items-center rounded-full border border-line-strong bg-ink-1 text-text-1 transition-colors hover:border-white/30 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div
          ref={stripRef}
          role="listbox"
          aria-label="Recorded days"
          className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
        >
          {[...stripKeys].reverse().map((dayKey) => {
            const date = parseDayKey(dayKey);
            const isSelected = dayKey === safeSelectedKey;
            const hasTime = getDayTotal(records, dayKey) > 0;
            return (
              <button
                key={dayKey}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-day={dayKey}
                onClick={() => selectDay(dayKey)}
                className="relative min-h-[68px] w-[3.4rem] shrink-0 rounded-[18px] border px-1 py-2 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
                style={{
                  borderColor: isSelected ? "var(--volt)" : "var(--line)",
                  background: isSelected ? "rgba(142,123,255,0.16)" : "var(--ink-1)",
                  boxShadow: isSelected ? "0 10px 28px -16px rgba(142,123,255,0.8)" : undefined,
                }}
              >
                <p className={`text-[0.58rem] font-semibold uppercase tracking-[0.12em] ${isSelected ? "text-volt-hi" : "text-text-3"}`}>
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </p>
                <p className="numeric mt-0.5 text-lg font-semibold text-text-1">{date.getDate()}</p>
                <span
                  className={`mx-auto mt-1 block size-1 rounded-full ${hasTime ? "bg-ice" : "bg-white/15"}`}
                />
              </button>
            );
          })}
        </div>
      </ScreenHeader>

      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={safeSelectedKey}
          custom={direction}
          initial={{ opacity: 0, x: direction * 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -18 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <section className="mt-5 grid grid-cols-2 gap-2">
            <StatTile label="Total tracked" value={formatSummaryDuration(dayTotal)} accent="#5FE3FF" emphasis />
            <StatTile
              label="Goals met"
              value={goals.total > 0 ? `${goals.met}/${goals.total}` : "—"}
              accent="#6CF2C2"
              emphasis
            />
          </section>

          {dayTotal > 0 && (
            <button
              type="button"
              onClick={() => setReplayOpen(true)}
              className="btn btn-ghost mt-4 h-12 w-full"
            >
              <Play className="size-4" />
              Replay day
            </button>
          )}

          <OrbitTimeline
            tracker={tracker}
            dayKey={safeSelectedKey}
            nowMs={nowMs}
            isToday={safeSelectedKey === todayKey}
          />

          <SectionCard
            title="Breakdown"
            aside={<p className="text-xs text-text-3">{breakdown.length} activities</p>}
          >
            {breakdown.length === 0 ? (
              recordedKeys.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="No history yet"
                  body="Your recorded days will appear here once you track time on Home."
                />
              ) : (
                <EmptyState
                  icon={CalendarDays}
                  title="Nothing recorded this day"
                  body="Pick a highlighted day above to review what you tracked."
                />
              )
            ) : (
              <ul>
                {breakdown.map((entry, index) => {
                  const goalMinutes =
                    entry.activity.archivedAtMs === null ? entry.activity.goalMinutes : null;
                  const goalMet = goalMinutes !== null && entry.ms >= goalMinutes * MS_PER_MINUTE;
                  return (
                    <ActivityBreakdownRow
                      key={entry.activity.id}
                      index={index}
                      {...entry}
                      trailing={
                        <p className="flex items-center gap-1 text-xs text-text-3">
                          {Math.round(entry.share * 100)}% of day
                          {goalMinutes !== null && (
                            <>
                              {" · "}
                              {goalMet ? (
                                <span className="inline-flex items-center gap-0.5 font-medium text-mint">
                                  <CheckCircle2 className="size-3" />
                                  Goal met
                                </span>
                              ) : (
                                `Goal ${goalMinutes}m`
                              )}
                            </>
                          )}
                        </p>
                      }
                    />
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {replayOpen && (
          <DayReplay
            key={safeSelectedKey}
            tracker={tracker}
            dayKey={safeSelectedKey}
            todayKey={todayKey}
            nowMs={nowMs}
            onClose={() => setReplayOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
