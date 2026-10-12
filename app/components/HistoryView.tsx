"use client";

import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, History } from "lucide-react";
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
import {
  ActivityBreakdownRow,
  EmptyState,
  formatSummaryDuration,
  ScreenHeader,
  SectionCard,
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

export function HistoryView({ tracker, todayKey }: { tracker: TrackerState; todayKey: string }) {
  const records = tracker.dailyRecords;
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [direction, setDirection] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

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
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => selectDay(shiftDayKey(safeSelectedKey, -1))}
            disabled={!canGoBack}
            aria-label="Previous day"
            className="grid size-10 place-items-center rounded-full border border-white/12 bg-white/[0.03] text-white/80 transition-colors hover:border-white/30 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="min-w-0 text-center">
            <p className="text-sm font-semibold text-white">{describeDay(safeSelectedKey, todayKey)}</p>
            <p className="text-xs text-white/50">
              {selectedDate.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => selectDay(shiftDayKey(safeSelectedKey, 1))}
            disabled={!canGoForward}
            aria-label="Next day"
            className="grid size-10 place-items-center rounded-full border border-white/12 bg-white/[0.03] text-white/80 transition-colors hover:border-white/30 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div
          ref={stripRef}
          role="listbox"
          aria-label="Recorded days"
          className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
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
                className="relative w-[3.25rem] shrink-0 rounded-2xl border px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                style={{
                  borderColor: isSelected ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.1)",
                  background: isSelected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
                }}
              >
                <p className="text-[0.56rem] uppercase tracking-[0.12em] text-white/50">
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-white">{date.getDate()}</p>
                <span
                  className={`mx-auto mt-1 block size-1 rounded-full ${hasTime ? "bg-[#84D7B4]" : "bg-white/15"}`}
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
          <section className="mt-3 grid grid-cols-2 gap-2.5">
            <article className="rounded-[20px] border border-white/10 bg-[#11161e] px-4 py-3">
              <p className="text-[0.6rem] uppercase tracking-[0.18em] text-white/45">Total tracked</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-white">
                {formatSummaryDuration(dayTotal)}
              </p>
            </article>
            <article className="rounded-[20px] border border-white/10 bg-[#11161e] px-4 py-3">
              <p className="text-[0.6rem] uppercase tracking-[0.18em] text-white/45">Goals met</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-white">
                {goals.total > 0 ? `${goals.met}/${goals.total}` : "—"}
              </p>
            </article>
          </section>

          <SectionCard
            title="Breakdown"
            aside={<p className="text-xs text-white/50">{breakdown.length} activities</p>}
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
              <ul className="space-y-2">
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
                        <p className="flex items-center gap-1 text-xs text-white/50">
                          {Math.round(entry.share * 100)}% of day
                          {goalMinutes !== null && (
                            <>
                              {" · "}
                              {goalMet ? (
                                <span className="inline-flex items-center gap-0.5 text-[#84D7B4]">
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
    </>
  );
}
