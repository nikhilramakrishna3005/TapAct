"use client";

import { motion } from "motion/react";
import { BarChart3, Flame, PieChart, Target } from "lucide-react";
import { useMemo, useState } from "react";
import {
  getBreakdown,
  getDayTotal,
  getGoalMetrics,
  getLastNDays,
  getMonthStartKey,
  getWeekStartKey,
  sumRange,
} from "@/lib/insights";
import type { TrackerState } from "@/lib/tracker";
import {
  ActivityBreakdownRow,
  EmptyState,
  formatCompactHours,
  formatSummaryDuration,
  Ring,
  ScreenHeader,
  SectionCard,
} from "./ui";

type Period = "today" | "week" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
};

const CHART_HEIGHT = 132;

export function InsightsView({ tracker, todayKey }: { tracker: TrackerState; todayKey: string }) {
  const [period, setPeriod] = useState<Period>("week");
  const [selectedBarKey, setSelectedBarKey] = useState<string | null>(null);
  const records = tracker.dailyRecords;

  const weekStartKey = getWeekStartKey(todayKey);
  const monthStartKey = getMonthStartKey(todayKey);

  const totals = useMemo(
    () => ({
      today: getDayTotal(records, todayKey),
      week: sumRange(records, weekStartKey, todayKey),
      month: sumRange(records, monthStartKey, todayKey),
    }),
    [monthStartKey, records, todayKey, weekStartKey],
  );

  const bars = useMemo(
    () => getLastNDays(records, tracker.activities, todayKey, 7),
    [records, todayKey, tracker.activities],
  );
  const maxBarMs = Math.max(...bars.map((bar) => bar.totalMs), 0);
  const sevenDayTotal = bars.reduce((sum, bar) => sum + bar.totalMs, 0);
  const activeDays = bars.filter((bar) => bar.totalMs > 0).length;

  const periodStartKey =
    period === "today" ? todayKey : period === "week" ? weekStartKey : monthStartKey;
  const breakdown = useMemo(
    () => getBreakdown(records, tracker.activities, periodStartKey, todayKey),
    [periodStartKey, records, todayKey, tracker.activities],
  );

  const goals = useMemo(
    () => getGoalMetrics(records, tracker.activities, todayKey),
    [records, todayKey, tracker.activities],
  );

  const hasAnyHistory = Object.keys(records).length > 0;
  const selectedBar = bars.find((bar) => bar.dayKey === selectedBarKey) ?? null;

  return (
    <>
      <ScreenHeader eyebrow="Insights" title="See where your time goes.">
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {(["today", "week", "month"] as const).map((key) => (
            <article
              key={key}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3"
            >
              <p className="text-[0.6rem] uppercase tracking-[0.18em] text-white/45">
                {key === "today" ? "Today" : key === "week" ? "This week" : "This month"}
              </p>
              <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-white">
                {formatSummaryDuration(totals[key])}
              </p>
            </article>
          ))}
        </div>
      </ScreenHeader>

      <SectionCard
        title="Last 7 days"
        aside={
          <p className="text-xs text-white/50">
            {formatSummaryDuration(sevenDayTotal)} · {activeDays}/7 days
          </p>
        }
      >
        {sevenDayTotal === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No activity this week yet"
            body="Tap an activity on Home to start tracking. Your daily totals will build up here."
          />
        ) : (
          <>
            <div className="flex items-end justify-between gap-2" style={{ height: CHART_HEIGHT }}>
              {bars.map((bar, index) => {
                const isToday = bar.dayKey === todayKey;
                const isSelected = bar.dayKey === selectedBarKey;
                const height = maxBarMs > 0 ? (bar.totalMs / maxBarMs) * CHART_HEIGHT : 0;
                return (
                  <button
                    key={bar.dayKey}
                    type="button"
                    onClick={() => setSelectedBarKey(isSelected ? null : bar.dayKey)}
                    aria-label={`${bar.date.toLocaleDateString(undefined, {
                      weekday: "long",
                    })}: ${formatSummaryDuration(bar.totalMs)}`}
                    aria-pressed={isSelected}
                    className="flex h-full flex-1 flex-col justify-end rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <motion.div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-[10px] bg-white/[0.06]"
                      initial={{ height: 0 }}
                      animate={{ height: Math.max(height, bar.totalMs > 0 ? 6 : 4) }}
                      transition={{ duration: 0.55, ease: "easeOut", delay: index * 0.05 }}
                      style={{
                        opacity: selectedBarKey && !isSelected ? 0.45 : 1,
                        outline: isToday ? "1px solid rgba(255,255,255,0.28)" : undefined,
                        outlineOffset: 2,
                      }}
                    >
                      {bar.segments.map((segment) => (
                        <div
                          key={segment.activity.id}
                          style={{
                            background: segment.activity.color,
                            height: `${(segment.ms / bar.totalMs) * 100}%`,
                          }}
                        />
                      ))}
                    </motion.div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between gap-2">
              {bars.map((bar) => (
                <p
                  key={bar.dayKey}
                  className={`flex-1 text-center text-[0.62rem] font-medium uppercase tracking-[0.08em] ${
                    bar.dayKey === todayKey ? "text-white" : "text-white/45"
                  }`}
                >
                  {bar.date.toLocaleDateString(undefined, { weekday: "narrow" })}
                </p>
              ))}
            </div>
            <p className="mt-3 min-h-[1rem] text-center text-xs text-white/55">
              {selectedBar
                ? `${selectedBar.date.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })} · ${formatSummaryDuration(selectedBar.totalMs)}`
                : `Daily average ${formatSummaryDuration(sevenDayTotal / 7)} · Peak ${formatCompactHours(maxBarMs)}`}
            </p>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Goals"
        aside={<Target className="size-4 text-white/45" />}
      >
        {goals.todayTotal === 0 ? (
          <EmptyState
            icon={Target}
            title="No daily goals set"
            body="Add a daily goal to an activity from Manage on Home to see completion metrics."
          />
        ) : (
          <div className="grid grid-cols-[auto_1fr] items-center gap-4">
            <Ring
              size={104}
              stroke={8}
              ratio={goals.weekHitRate}
              color="#84D7B4"
            >
              <p className="text-lg font-semibold text-white">
                {Math.round(goals.weekHitRate * 100)}%
              </p>
              <p className="text-[0.55rem] uppercase tracking-[0.16em] text-white/45">7-day hit</p>
            </Ring>
            <dl className="space-y-2">
              <GoalStat label="Today" value={`${goals.todayMet}/${goals.todayTotal} met`} />
              <GoalStat label="Goals hit (7d)" value={`${goals.weekHits}/${goals.weekPossible}`} />
              <GoalStat label="Perfect days (7d)" value={`${goals.perfectDays}/7`} />
              <GoalStat
                label="Perfect streak"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Flame className="size-3.5 text-[#FFB47D]" />
                    {goals.perfectStreak} {goals.perfectStreak === 1 ? "day" : "days"}
                  </span>
                }
              />
            </dl>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Activity breakdown"
        aside={
          <div className="flex rounded-full border border-white/12 bg-[#0f141d] p-0.5">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                aria-pressed={period === key}
                className="relative rounded-full px-2.5 py-1 text-[0.68rem] font-medium text-white/60 aria-pressed:text-white"
              >
                {period === key && (
                  <motion.span
                    layoutId="insights-period"
                    className="absolute inset-0 rounded-full bg-white/[0.09]"
                    transition={{ type: "spring", damping: 30, stiffness: 380 }}
                  />
                )}
                <span className="relative">{PERIOD_LABELS[key]}</span>
              </button>
            ))}
          </div>
        }
      >
        {breakdown.length === 0 ? (
          <EmptyState
            icon={PieChart}
            title={hasAnyHistory ? `Nothing tracked ${period === "today" ? "today" : `this ${period}`}` : "No history yet"}
            body={
              hasAnyHistory
                ? "Switch the range or start an activity to fill this breakdown."
                : "Once you track time, each activity's share will appear here."
            }
          />
        ) : (
          <ul key={period} className="space-y-2">
            {breakdown.map((entry, index) => (
              <ActivityBreakdownRow key={entry.activity.id} index={index} {...entry} />
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function GoalStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5 last:border-0 last:pb-0">
      <dt className="text-xs text-white/50">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-white">{value}</dd>
    </div>
  );
}
