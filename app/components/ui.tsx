"use client";

import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  Code2,
  Dumbbell,
  Globe2,
  HeartPulse,
  Languages,
  MessageSquare,
  Music2,
  Palette,
  PenLine,
} from "lucide-react";
import { MS_PER_MINUTE, type Activity, type ActivityIconName } from "@/lib/tracker";

export const ICON_REGISTRY: Record<ActivityIconName, { label: string; icon: LucideIcon }> = {
  brain: { label: "Focus", icon: BrainCircuit },
  dumbbell: { label: "Fitness", icon: Dumbbell },
  message: { label: "Talk", icon: MessageSquare },
  book: { label: "Reading", icon: BookOpen },
  briefcase: { label: "Work", icon: BriefcaseBusiness },
  code: { label: "Code", icon: Code2 },
  languages: { label: "Language", icon: Languages },
  heart: { label: "Health", icon: HeartPulse },
  music: { label: "Music", icon: Music2 },
  globe: { label: "Global", icon: Globe2 },
  pen: { label: "Writing", icon: PenLine },
  palette: { label: "Creative", icon: Palette },
};

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}

export function formatSummaryDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatCompactHours(ms: number): string {
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes === 0 ? `${hours}h` : `${hours}.${Math.floor(minutes / 6)}h`;
  }
  return `${Math.max(totalMinutes, 0)}m`;
}

export function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function Ring({
  size,
  stroke,
  ratio,
  color,
  children,
}: {
  size: number;
  stroke: number;
  ratio: number;
  color: string;
  children: React.ReactNode;
}) {
  const safeRatio = clampRatio(ratio);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safeRatio);

  return (
    <div className="relative inline-grid place-items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-white/10"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          initial={false}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </svg>
      <div className="pointer-events-none absolute text-center">{children}</div>
    </div>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="rounded-[28px] border border-white/10 bg-[#11161e] px-4 py-4 shadow-[0_18px_50px_-34px_rgba(0,0,0,1)]">
      <p className="text-[0.63rem] uppercase tracking-[0.25em] text-white/50">{eyebrow}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">{title}</h1>
      {children}
    </header>
  );
}

export function SectionCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3 rounded-[24px] border border-white/10 bg-[#11161e] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[1.02rem] font-semibold tracking-tight text-white">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.015] px-4 py-7 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/60">
        <Icon className="size-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-white/85">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-white/50">{body}</p>
    </div>
  );
}

export function ActivityBreakdownRow({
  activity,
  ms,
  share,
  index,
  trailing,
}: {
  activity: Activity;
  ms: number;
  share: number;
  index: number;
  trailing?: React.ReactNode;
}) {
  const Icon = ICON_REGISTRY[activity.iconKey].icon;
  const isArchived = activity.archivedAtMs !== null;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="rounded-2xl border border-white/10 bg-[#0f141d] px-3 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="rounded-xl border border-white/10 p-2"
            style={{ color: activity.color, background: "rgba(255,255,255,0.03)" }}
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
              <span className="truncate">{activity.name}</span>
              {isArchived && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-white/12 px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.12em] text-white/50">
                  <Archive className="size-2.5" />
                  Archived
                </span>
              )}
            </p>
            {trailing ?? (
              <p className="text-xs text-white/50">{Math.round(share * 100)}% of tracked time</p>
            )}
          </div>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-white">
          {formatSummaryDuration(ms)}
        </p>
      </div>
      <div className="mt-2.5 h-1.5 rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full"
          style={{ background: activity.color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(clampRatio(share) * 100, 2)}%` }}
          transition={{ duration: 0.5, ease: "easeOut", delay: index * 0.04 }}
        />
      </div>
    </motion.li>
  );
}
