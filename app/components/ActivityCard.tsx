"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Pause, PencilLine, Play } from "lucide-react";
import { DURATION, EASE_OUT, SPRING_SNAPPY } from "@/lib/motion";
import { MS_PER_MINUTE, type Activity } from "@/lib/tracker";
import { clampRatio, formatClock, formatSummaryDuration, ICON_REGISTRY, tint } from "./ui";

const DEFAULT_ACTIVITY_GOAL = 45;

export type ActivityStatus = "running" | "paused" | "ready";

const STATUS_LABEL: Record<ActivityStatus, string> = {
  running: "Running",
  paused: "Paused",
  ready: "Ready",
};

export function ActivityCard({
  activity,
  elapsedMs,
  isActive,
  activeSinceMs,
  onToggle,
  onEdit,
}: {
  activity: Activity;
  elapsedMs: number;
  isActive: boolean;
  activeSinceMs: number | null;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const status: ActivityStatus = isActive ? "running" : elapsedMs > 0 ? "paused" : "ready";
  const goalMs = (activity.goalMinutes ?? DEFAULT_ACTIVITY_GOAL) * MS_PER_MINUTE;
  const progress = clampRatio(elapsedMs / goalMs);
  const goalMet = activity.goalMinutes !== null && activity.goalMinutes > 0 && elapsedMs >= goalMs;
  const Icon = ICON_REGISTRY[activity.iconKey].icon;
  const color = activity.color;
  const running = status === "running";

  return (
    <motion.article
      layout
      transition={{ layout: { duration: DURATION.base, ease: EASE_OUT } }}
      className="relative overflow-hidden rounded-[var(--radius-lg)]"
    >
      <motion.button
        type="button"
        onClick={onToggle}
        whileTap={{ scale: 0.985 }}
        transition={SPRING_SNAPPY}
        aria-pressed={running}
        aria-label={`${activity.name}, ${STATUS_LABEL[status]}, ${formatSummaryDuration(elapsedMs)} today. Tap to ${running ? "pause" : status === "paused" ? "resume" : "start"}.`}
        className="relative block w-full rounded-[var(--radius-lg)] border px-4 pb-4 pt-4 text-left transition-[border-color,background-color,box-shadow] duration-[260ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi focus-visible:ring-offset-2 focus-visible:ring-offset-ink-0"
        style={{
          borderColor: running ? tint(color, 0.55) : goalMet ? tint("#6CF2C2", 0.28) : "var(--line)",
          background: running
            ? `radial-gradient(120% 90% at 0% 0%, ${tint(color, 0.2)}, transparent 60%), var(--ink-2)`
            : "var(--ink-1)",
          boxShadow: running
            ? `0 22px 50px -30px ${tint(color, 0.7)}, inset 0 1px 0 var(--inset-line)`
            : "inset 0 1px 0 var(--inset-line)",
        }}
      >
        <div className="flex items-center gap-3 pr-12">
          <div className="relative grid size-11 shrink-0 place-items-center">
            <span
              className="absolute inset-0 rounded-[14px] transition-colors duration-[260ms]"
              style={{ background: running ? color : tint(color, 0.13) }}
            />
            <AnimatePresence>
              {running && (
                <motion.span
                  key={activeSinceMs ?? "run"}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[14px] border-2"
                  style={{ borderColor: color }}
                  initial={{ opacity: 0.7, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.7 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: EASE_OUT }}
                />
              )}
            </AnimatePresence>
            <Icon className="relative size-5" style={{ color: running ? "var(--ink-0)" : color }} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[1.05rem] font-semibold tracking-[-0.015em] text-text-1">{activity.name}</p>
            {activity.cue ? <p className="truncate text-xs text-text-3">{activity.cue}</p> : null}
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <motion.p
            layout="position"
            className={`numeric font-semibold leading-none transition-colors duration-[260ms] ${
              running ? "text-[2.6rem] text-text-1" : "text-[1.75rem]"
            } ${status === "ready" ? "text-text-3" : status === "paused" ? "text-text-2" : ""}`}
          >
            {formatClock(elapsedMs)}
          </motion.p>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DURATION.quick, ease: EASE_OUT }}
              className="mb-1 inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em]"
              style={{
                color: running ? color : status === "paused" ? "var(--text-2)" : "var(--text-3)",
                borderColor: running ? tint(color, 0.5) : "var(--line-strong)",
                background: running ? tint(color, 0.12) : "transparent",
              }}
            >
              {running ? (
                <span className="ambient-pulse size-1.5 rounded-full" style={{ background: color }} />
              ) : status === "paused" ? (
                <Pause className="size-2.5" fill="currentColor" />
              ) : (
                <Play className="size-2.5" fill="currentColor" />
              )}
              {STATUS_LABEL[status]}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="mt-4">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--track-soft)]">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: goalMet ? "var(--mint)" : color, opacity: running || goalMet ? 1 : 0.75 }}
              initial={false}
              animate={{ width: `${Math.max(progress * 100, elapsedMs > 0 ? 2 : 0)}%` }}
              transition={{ duration: DURATION.slow, ease: EASE_OUT }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[0.72rem] text-text-3">
            {goalMet ? (
              <span className="inline-flex items-center gap-1 font-medium text-mint">
                <Check className="size-3" strokeWidth={3} />
                Goal reached
              </span>
            ) : (
              <span>{Math.round(progress * 100)}% {activity.goalMinutes ? "of goal" : `of ${DEFAULT_ACTIVITY_GOAL}m`}</span>
            )}
            <span className="numeric">
              {formatSummaryDuration(elapsedMs)}
              {activity.goalMinutes ? ` / ${formatSummaryDuration(activity.goalMinutes * MS_PER_MINUTE)}` : " · no goal"}
            </span>
          </div>
        </div>
      </motion.button>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${activity.name}`}
        className="absolute right-2.5 top-2.5 z-10 grid size-11 place-items-center rounded-full text-text-3 transition-colors hover:bg-[var(--wash-strong)] hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
      >
        <PencilLine className="size-4" />
      </button>
    </motion.article>
  );
}
