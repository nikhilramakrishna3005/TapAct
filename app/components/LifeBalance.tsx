"use client";

import { AnimatePresence, motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BriefcaseBusiness,
  CircleDashed,
  GraduationCap,
  HeartPulse,
  Minus,
  Moon,
  Scale,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  type AreaSummary,
  type BalancePeriod,
  COMPARISON_LABEL,
  computeLifeBalance,
  formatBalanceDuration,
  formatShare,
  getObservations,
  LIFE_AREAS,
  type LifeAreaId,
} from "@/lib/lifeBalance";
import { DURATION, EASE_OUT } from "@/lib/motion";
import type { LifeCategoryId, TrackerState } from "@/lib/tracker";
import { useMotionPrefs } from "./MotionPrefs";
import { EmptyState, ICON_REGISTRY, SectionCard, Segmented, tint } from "./ui";

export const AREA_ICONS: Record<LifeAreaId, LucideIcon> = {
  work: BriefcaseBusiness,
  health: HeartPulse,
  learning: GraduationCap,
  relationships: Users,
  rest: Moon,
  unassigned: CircleDashed,
};

const PERIOD_OPTIONS: { value: BalancePeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
];

const RING_SIZE = 196;
const RING_STROKE = 16;
const GAP_DEG = 3;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

function ChangeChip({ ms, previousMs, period }: { ms: number; previousMs: number; period: BalancePeriod }) {
  const delta = ms - previousMs;
  const label = `${COMPARISON_LABEL[period]}`;
  if (previousMs === 0 && ms === 0) return null;
  if (previousMs === 0) {
    return <span className="text-[0.68rem] text-text-3">None {label === "yesterday" ? "yesterday" : `in ${label}`}</span>;
  }
  if (Math.abs(delta) < 60_000) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[0.68rem] text-text-3">
        <Minus className="size-3" aria-hidden="true" />
        Same as {label}
      </span>
    );
  }
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="numeric inline-flex items-center gap-0.5 text-[0.68rem] text-text-2">
      <Icon className="size-3" aria-hidden="true" />
      {delta > 0 ? "+" : "−"}
      {formatBalanceDuration(Math.abs(delta))} vs {label}
    </span>
  );
}

export function LifeBalanceSection({ tracker, todayKey }: { tracker: TrackerState; todayKey: string }) {
  const { reduced } = useMotionPrefs();
  const [period, setPeriod] = useState<BalancePeriod>("7d");
  const [selectedId, setSelectedId] = useState<LifeAreaId | null>(null);

  const balance = useMemo(
    () => computeLifeBalance(tracker.dailyRecords, tracker.activities, todayKey, period),
    [period, todayKey, tracker.activities, tracker.dailyRecords],
  );
  const observations = useMemo(() => getObservations(balance), [balance]);
  const visibleAreas = balance.areas.filter((area) => area.ms > 0 || area.previousMs > 0);
  const quietAreas = balance.areas.filter((area) => area.ms === 0 && area.previousMs === 0 && area.id !== "unassigned");
  const selected = balance.areas.find((area) => area.id === selectedId && area.ms + area.previousMs > 0) ?? null;

  const arcs = useMemo(() => {
    const tracked = balance.areas.filter((area) => area.ms > 0);
    const gap = tracked.length > 1 ? GAP_DEG : 0;
    let cursor = 0;
    return tracked.map((area) => {
      const sweep = area.share * 360;
      const arc = { area, start: cursor + gap / 2, end: cursor + Math.max(sweep - gap / 2, gap / 2 + 0.6) };
      cursor += sweep;
      return arc;
    });
  }, [balance.areas]);

  const r = (RING_SIZE - RING_STROKE) / 2 - 6;
  const c = RING_SIZE / 2;

  return (
    <SectionCard title="Life Balance">
      <div className="mb-4">
        <Segmented
          label="Life Balance range"
          layoutId="life-balance-period"
          size="md"
          value={period}
          onChange={(value) => {
            setPeriod(value);
            setSelectedId(null);
          }}
          options={PERIOD_OPTIONS}
        />
      </div>
      {balance.totalMs === 0 && balance.previousTotalMs === 0 ? (
        <EmptyState
          icon={Scale}
          title={period === "today" ? "Nothing tracked today yet" : `Nothing tracked in the last ${balance.range.days} days`}
          body="Assign your activities to life areas from Manage on Home, then track time to see how it's spread."
        />
      ) : (
        <>
          <div className="relative mx-auto grid place-items-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              role="img"
              aria-label={
                selected
                  ? `${selected.label}: ${formatBalanceDuration(selected.ms)}, ${formatShare(selected.share)} of tracked time`
                  : `Tracked time by life area: ${arcs
                      .map(({ area }) => `${area.label} ${formatShare(area.share)}`)
                      .join(", ")}`
              }
            >
              <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={RING_STROKE} />
              <circle cx={c} cy={c} r={r - RING_STROKE} fill="none" stroke="rgba(255,255,255,0.06)" strokeDasharray="2 5" />
              {arcs.map(({ area, start, end }, index) => {
                const isSelected = selectedId === area.id;
                const dimmed = selected !== null && !isSelected;
                const full = arcs.length === 1;
                const common = {
                  fill: "none",
                  stroke: area.color,
                  strokeWidth: isSelected ? RING_STROKE + 4 : RING_STROKE,
                  style: {
                    cursor: "pointer",
                    filter: isSelected ? `drop-shadow(0 0 10px ${tint(area.color, 0.7)})` : undefined,
                    transition: "stroke-width 200ms, opacity 200ms",
                  },
                  opacity: dimmed ? 0.3 : 1,
                  onClick: () => setSelectedId(isSelected ? null : area.id),
                };
                return full ? (
                  <motion.circle
                    key={`${period}-${area.id}`}
                    cx={c}
                    cy={c}
                    r={r}
                    {...common}
                    initial={reduced ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: DURATION.slow * 2, ease: EASE_OUT }}
                  />
                ) : (
                  <motion.path
                    key={`${period}-${area.id}`}
                    d={arcPath(c, c, r, start, end)}
                    {...common}
                    initial={reduced ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: DURATION.slow * 1.6, ease: EASE_OUT, delay: index * 0.06 }}
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-live="polite">
              <div className="max-w-[120px]">
                {selected ? (
                  <>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em]" style={{ color: selected.color }}>
                      {selected.label}
                    </p>
                    <p className="numeric mt-1 text-2xl font-semibold text-text-1">{formatBalanceDuration(selected.ms)}</p>
                    <p className="numeric text-xs text-text-3">{formatShare(selected.share)} of tracked</p>
                  </>
                ) : (
                  <>
                    <p className="eyebrow !text-[0.58rem]">Tracked</p>
                    <p className="numeric mt-1 text-2xl font-semibold text-text-1">{formatBalanceDuration(balance.totalMs)}</p>
                    <p className="text-xs text-text-3">
                      {period === "today" ? "today" : `last ${balance.range.days} days`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <ul className="mt-4 space-y-1" aria-label="Life areas">
            {visibleAreas.map((area) => (
              <AreaRow
                key={area.id}
                area={area}
                period={period}
                expanded={selectedId === area.id}
                onToggle={() => setSelectedId(selectedId === area.id ? null : area.id)}
              />
            ))}
          </ul>

          {quietAreas.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text-3">
              <span>No tracked time:</span>
              {quietAreas.map((area) => {
                const Icon = AREA_ICONS[area.id];
                return (
                  <span key={area.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
                    <Icon className="size-3" style={{ color: area.color }} aria-hidden="true" />
                    {area.label}
                  </span>
                );
              })}
            </p>
          )}

          {observations.length > 0 && (
            <div className="mt-4 rounded-[16px] border border-line bg-ink-0/60 px-3.5 py-3">
              <p className="eyebrow !text-[0.58rem] !tracking-[0.18em]">Observations</p>
              <ul className="mt-2 space-y-1.5">
                {observations.map((note) => (
                  <li key={note} className="flex gap-2 text-xs leading-relaxed text-text-2">
                    <span aria-hidden="true" className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-volt-hi" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[0.68rem] leading-relaxed text-text-3">
            Only tracked time is included. Untracked time isn&apos;t counted as Rest or any other area.
          </p>
        </>
      )}
    </SectionCard>
  );
}

function AreaRow({
  area,
  period,
  expanded,
  onToggle,
}: {
  area: AreaSummary;
  period: BalancePeriod;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = AREA_ICONS[area.id];
  const contributing = area.activities;
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
        style={expanded ? { background: tint(area.color, 0.1) } : undefined}
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-xl"
          style={{ color: area.color, background: tint(area.color, 0.13) }}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-text-1">{area.label}</span>
            <span className="numeric shrink-0 text-sm font-semibold text-text-1">
              {formatBalanceDuration(area.ms)}
              <span className="ml-2 text-xs font-medium text-text-3">{formatShare(area.share)}</span>
            </span>
          </span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.span
              className="block h-full rounded-full"
              style={{ background: area.color }}
              initial={{ width: 0 }}
              animate={{ width: `${area.share > 0 ? Math.max(area.share * 100, 2) : 0}%` }}
              transition={{ duration: DURATION.slow, ease: EASE_OUT }}
            />
          </span>
          <span className="mt-1 block">
            <ChangeChip ms={area.ms} previousMs={area.previousMs} period={period} />
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <ul className="ml-12 mr-2 border-l border-line pb-2 pl-3 pt-1" aria-label={`${area.label} activities`}>
              {contributing.map(({ activity, ms }) => {
                const ActivityIcon = ICON_REGISTRY[activity.iconKey].icon;
                return (
                  <li key={activity.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ActivityIcon className="size-3.5 shrink-0" style={{ color: activity.color }} aria-hidden="true" />
                      <span className="truncate text-text-1">{activity.name}</span>
                      {activity.archivedAtMs !== null && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-strong px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.12em] text-text-3">
                          <Archive className="size-2.5" />
                          Archived
                        </span>
                      )}
                    </span>
                    <span className="numeric shrink-0 text-text-2">
                      {formatBalanceDuration(ms)}
                      {area.ms > 0 && <span className="ml-2 text-xs text-text-3">{formatShare(ms / area.ms)}</span>}
                    </span>
                  </li>
                );
              })}
              {area.id === "unassigned" && (
                <li className="pt-1 text-xs text-text-3">Assign a life area from Manage on Home.</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function LifeAreaPicker({
  value,
  onChange,
}: {
  value: LifeCategoryId | null;
  onChange: (value: LifeCategoryId | null) => void;
}) {
  return (
    <fieldset>
      <legend className="eyebrow mb-2">Life area</legend>
      <div className="grid grid-cols-3 gap-2">
        {LIFE_AREAS.map((area) => {
          const id = area.id === "unassigned" ? null : area.id;
          const selected = value === id;
          const Icon = AREA_ICONS[area.id];
          return (
            <button
              key={area.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(id)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
              style={{
                borderColor: selected ? area.color : "var(--line)",
                background: selected ? tint(area.color, 0.14) : "var(--ink-0)",
                color: selected ? "var(--text-1)" : "var(--text-2)",
              }}
            >
              <Icon className="size-3.5 shrink-0" style={{ color: area.color }} aria-hidden="true" />
              <span className="truncate">{area.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
