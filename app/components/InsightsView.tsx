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
import { DURATION, EASE_OUT } from "@/lib/motion";
import type { TrackerState } from "@/lib/tracker";
import { LifeBalanceSection } from "./LifeBalance";
import {
  ActivityBreakdownRow,
  EmptyState,
  formatCompactHours,
  formatSummaryDuration,
  Ring,
  ScreenHeader,
  SectionCard,
  Segmented,
} from "./ui";

type Period = "today" | "week" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
};

const CHART_HEIGHT = 148;

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
        <div className="mt-6 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">This week</p>
            <p className="numeric mt-2 text-[2.9rem] font-semibold leading-none text-text-1">
              {formatSummaryDuration(totals.week)}
            </p>
          </div>
          <dl className="space-y-2 pb-1 text-right">
            <div>
              <dt className="eyebrow !text-[0.58rem]">Today</dt>
              <dd className="numeric mt-0.5 text-base font-semibold text-text-1">
                {formatSummaryDuration(totals.today)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow !text-[0.58rem]">This month</dt>
              <dd className="numeric mt-0.5 text-base font-semibold text-text-1">
                {formatSummaryDuration(totals.month)}
              </dd>
            </div>
          </dl>
        </div>
      </ScreenHeader>

      <SectionCard
        title="Last 7 days"
        aside={
          <p className="numeric text-xs text-text-3">
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
            <div className="relative flex items-end justify-between gap-2.5" style={{ height: CHART_HEIGHT }}>
              {maxBarMs > 0 && sevenDayTotal / 7 > 0 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ice/40"
                  style={{ bottom: (sevenDayTotal / 7 / maxBarMs) * CHART_HEIGHT }}
                >
                  <span className="absolute -top-4 right-0 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-ice/80">
                    avg
                  </span>
                </div>
              )}
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
                    className="relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
                  >
                    <motion.div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-[8px] bg-white/[0.05]"
                      initial={{ height: 0 }}
                      animate={{ height: Math.max(height, bar.totalMs > 0 ? 6 : 4) }}
                      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: index * 0.035 }}
                      style={{
                        opacity: selectedBarKey && !isSelected ? 0.35 : 1,
                        boxShadow: isToday ? "0 0 0 1.5px var(--ice)" : undefined,
                        transition: "opacity 200ms",
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
                  className={`flex-1 text-center text-[0.66rem] font-semibold uppercase tracking-[0.08em] ${
                    bar.dayKey === todayKey ? "text-ice" : "text-text-3"
                  }`}
                >
                  {bar.date.toLocaleDateString(undefined, { weekday: "narrow" })}
                </p>
              ))}
            </div>
            <p className="numeric mt-4 min-h-[1rem] text-center text-xs text-text-2">
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

      <LifeBalanceSection tracker={tracker} todayKey={todayKey} />

      <SectionCard
        title="Goals"
        aside={<Target className="size-4 text-text-3" />}
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
              color="#6CF2C2"
            >
              <p className="numeric text-xl font-semibold text-text-1">
                {Math.round(goals.weekHitRate * 100)}%
              </p>
              <p className="text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-text-3">7-day hit</p>
            </Ring>
            <dl className="space-y-2">
              <GoalStat label="Today" value={`${goals.todayMet}/${goals.todayTotal} met`} />
              <GoalStat label="Goals hit (7d)" value={`${goals.weekHits}/${goals.weekPossible}`} />
              <GoalStat label="Perfect days (7d)" value={`${goals.perfectDays}/7`} />
              <GoalStat
                label="Perfect streak"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Flame className="size-3.5 text-ember" />
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
          <Segmented
            label="Breakdown range"
            layoutId="insights-period"
            value={period}
            onChange={setPeriod}
            options={(Object.keys(PERIOD_LABELS) as Period[]).map((key) => ({ value: key, label: PERIOD_LABELS[key] }))}
          />
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
          <ul key={period}>
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
    <div className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0 last:pb-0">
      <dt className="text-xs text-text-3">{label}</dt>
      <dd className="numeric text-sm font-semibold text-text-1">{value}</dd>
    </div>
  );
}
