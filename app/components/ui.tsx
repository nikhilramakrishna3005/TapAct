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
  X,
} from "lucide-react";
import { useEffect } from "react";
import { DURATION, EASE_OUT, SPRING_SHEET, SPRING_SNAPPY } from "@/lib/motion";
import { MS_PER_MINUTE, type Activity, type ActivityIconName } from "@/lib/tracker";
import { OrbitMark } from "./Orbit";

/** Expressive activity accents, tuned to stay legible on the graphite surfaces. */
export const COLOR_OPTIONS = [
  "#8E7BFF",
  "#5FE3FF",
  "#6CF2C2",
  "#A7F06B",
  "#FFE36B",
  "#FFB86B",
  "#FF7AB6",
  "#C2C6D6",
];

/** Translucent wash of an activity color (hex) for tinted surfaces. */
export function tint(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  if (!/^#[0-9a-fA-F]{6}$/.test(hex) || Number.isNaN(value)) {
    return `rgba(255,255,255,${alpha})`;
  }
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

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
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - stroke}
          strokeWidth={1}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeDasharray="2 5"
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
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
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
  compact = false,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={compact ? "pt-1" : "pt-2"}>
      <div className="flex items-center gap-2">
        <OrbitMark size={18} />
        <p className="eyebrow">{eyebrow}</p>
      </div>
      <h1 className={`display ${compact ? "mt-1 text-[1.45rem]" : "mt-3 text-[2rem]"}`}>{title}</h1>
      {children}
    </header>
  );
}

export function Sheet({
  label,
  onClose,
  children,
  layer = "base",
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  layer?: "base" | "nested";
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <motion.div
      className={`fixed inset-0 bg-black/70 ${layer === "nested" ? "z-40" : "z-30"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.quick }}
      onClick={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SPRING_SHEET}
        onClick={(event) => event.stopPropagation()}
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-[var(--radius-xl)] border border-b-0 border-line-strong bg-ink-1 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-24px_60px_-30px_rgba(0,0,0,1)]"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        <div className="mt-3 flex items-center justify-between">
          <h3 className="display text-[1.35rem]">{label}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-full border border-line-strong text-text-2 transition-colors hover:text-text-1"
            aria-label={`Close ${label.toLowerCase()} panel`}
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </motion.section>
    </motion.div>
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
    <section className="panel mt-4 px-4 py-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-[0.95rem] font-semibold tracking-[-0.01em] text-text-1">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  accent,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className="relative overflow-hidden rounded-[var(--radius-md)] border border-line bg-ink-1 px-3.5 py-3"
      style={emphasis && accent ? { borderColor: tint(accent, 0.35) } : undefined}
    >
      {accent && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-3 h-5 w-[3px] rounded-r-full"
          style={{ background: accent }}
        />
      )}
      <p className="eyebrow !text-[0.58rem] !tracking-[0.18em]">{label}</p>
      <p className={`numeric mt-1.5 font-semibold text-text-1 ${emphasis ? "text-[1.6rem]" : "text-lg"}`}>
        {value}
      </p>
    </article>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  label,
  size = "sm",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex rounded-full border border-line-strong bg-ink-0 p-1 ${size === "md" ? "w-full" : ""}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`relative flex-1 rounded-full font-medium transition-colors ${
              size === "md" ? "min-h-10 px-3 text-sm" : "min-h-8 px-3 text-[0.72rem]"
            } ${selected ? "text-ink-0" : "text-text-2 hover:text-text-1"}`}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-text-1"
                transition={SPRING_SNAPPY}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-md)] border border-dashed border-line-strong px-4 py-8 text-center">
      <div className="relative mx-auto grid size-14 place-items-center">
        <svg viewBox="0 0 56 56" className="absolute inset-0" aria-hidden="true">
          <circle cx="28" cy="28" r="26" fill="none" stroke="rgba(255,255,255,0.1)" strokeDasharray="2 5" />
          <circle cx="28" cy="2" r="2.5" fill="var(--volt)" />
        </svg>
        <Icon className="size-5 text-text-2" />
      </div>
      <p className="mt-3 text-sm font-semibold text-text-1">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-text-3">{body}</p>
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
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: Math.min(index, 6) * 0.035 }}
      className="py-3 first:pt-0 last:pb-0 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{ color: activity.color, background: tint(activity.color, 0.12) }}
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-text-1">
              <span className="truncate">{activity.name}</span>
              {isArchived && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-strong px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.12em] text-text-3">
                  <Archive className="size-2.5" />
                  Archived
                </span>
              )}
            </p>
            {trailing ?? (
              <p className="text-xs text-text-3">{Math.round(share * 100)}% of tracked time</p>
            )}
          </div>
        </div>
        <p className="numeric shrink-0 text-sm font-semibold text-text-1">{formatSummaryDuration(ms)}</p>
      </div>
      <div className="ml-12 mt-2 h-1 rounded-full bg-white/[0.06]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: activity.color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(clampRatio(share) * 100, 2)}%` }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: Math.min(index, 6) * 0.035 }}
        />
      </div>
    </motion.li>
  );
}
