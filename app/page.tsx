"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Dumbbell,
  House,
  LineChart,
  MessageSquare,
  Settings2,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ActivityId = "coding" | "gym" | "communication" | "reading";

type TrackerState = {
  dayKey: string;
  activeActivityId: ActivityId | null;
  activeSinceMs: number | null;
  elapsedMs: Record<ActivityId, number>;
};

const STORAGE_KEY = "tapact.tracker.v1";
const MS_PER_MINUTE = 60_000;

const ACTIVITY_CONFIG = [
  {
    id: "coding",
    label: "Coding",
    description: "Deep work and software builds",
    icon: BrainCircuit,
    accent: "#8B95FF",
    goalMinutes: 140,
  },
  {
    id: "gym",
    label: "Gym",
    description: "Strength, cardio, and recovery",
    icon: Dumbbell,
    accent: "#4FD1A5",
    goalMinutes: 50,
  },
  {
    id: "communication",
    label: "Communication",
    description: "Speaking and conversation practice",
    icon: MessageSquare,
    accent: "#E0A6FF",
    goalMinutes: 45,
  },
  {
    id: "reading",
    label: "Reading",
    description: "Books, papers, and focused study",
    icon: BookOpen,
    accent: "#7EC8F8",
    goalMinutes: 60,
  },
] as const;

const ACTIVITY_IDS = ACTIVITY_CONFIG.map((activity) => activity.id);
const DAILY_TARGET_MINUTES = 300;

function getTodayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDefaultState(dayKey: string): TrackerState {
  return {
    dayKey,
    activeActivityId: null,
    activeSinceMs: null,
    elapsedMs: {
      coding: 0,
      gym: 0,
      communication: 0,
      reading: 0,
    },
  };
}

function normalizeStoredState(value: unknown, nowMs: number): TrackerState {
  const todayKey = getTodayKey(new Date(nowMs));
  const fallback = createDefaultState(todayKey);

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<TrackerState> & {
    elapsedMs?: Record<string, unknown>;
  };

  if (candidate.dayKey !== todayKey) {
    return fallback;
  }

  const elapsedMs = { ...fallback.elapsedMs };
  for (const activityId of ACTIVITY_IDS) {
    const rawValue = candidate.elapsedMs?.[activityId];
    if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue >= 0) {
      elapsedMs[activityId] = rawValue;
    }
  }

  const activityIdIsValid =
    typeof candidate.activeActivityId === "string" &&
    ACTIVITY_IDS.includes(candidate.activeActivityId as ActivityId);
  const activeActivityId = activityIdIsValid
    ? (candidate.activeActivityId as ActivityId)
    : null;

  let activeSinceMs: number | null = null;
  if (
    activeActivityId &&
    typeof candidate.activeSinceMs === "number" &&
    Number.isFinite(candidate.activeSinceMs) &&
    candidate.activeSinceMs > 0
  ) {
    activeSinceMs = Math.min(candidate.activeSinceMs, nowMs);
  }

  return {
    dayKey: todayKey,
    activeActivityId,
    activeSinceMs,
    elapsedMs,
  };
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}

function formatSummaryDuration(ms: number): string {
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

function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

function ProgressRing({
  progress,
  accent,
  size = 176,
  stroke = 12,
  children,
}: {
  progress: number;
  accent: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const normalized = Math.max(0, Math.min(1, progress));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized);

  return (
    <div className="relative inline-grid place-items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-white/8"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          stroke={accent}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          initial={false}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
      </svg>
      <div className="pointer-events-none absolute text-center">{children}</div>
    </div>
  );
}

export default function Home() {
  const [tracker, setTracker] = useState<TrackerState>(() =>
    createDefaultState(getTodayKey(new Date())),
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const now = Date.now();
    try {
      const rawState = window.localStorage.getItem(STORAGE_KEY);
      if (rawState) {
        const parsed = JSON.parse(rawState) as unknown;
        setTracker(normalizeStoredState(parsed, now));
      } else {
        setTracker(createDefaultState(getTodayKey(new Date(now))));
      }
    } catch {
      setTracker(createDefaultState(getTodayKey(new Date(now))));
    } finally {
      setHydrated(true);
      setNowMs(now);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tracker));
  }, [hydrated, tracker]);

  useEffect(() => {
    const currentDay = getTodayKey(new Date(nowMs));
    setTracker((previous) =>
      previous.dayKey === currentDay ? previous : createDefaultState(currentDay),
    );
  }, [nowMs]);

  const elapsedByActivity = useMemo<Record<ActivityId, number>>(() => {
    const elapsed = { ...tracker.elapsedMs };
    if (tracker.activeActivityId && tracker.activeSinceMs) {
      const runningMs = Math.max(0, nowMs - tracker.activeSinceMs);
      elapsed[tracker.activeActivityId] += runningMs;
    }
    return elapsed;
  }, [nowMs, tracker.activeActivityId, tracker.activeSinceMs, tracker.elapsedMs]);

  const totalTrackedMs = useMemo(() => {
    return ACTIVITY_IDS.reduce((sum, activityId) => sum + elapsedByActivity[activityId], 0);
  }, [elapsedByActivity]);

  const goalsCompleted = useMemo(() => {
    return ACTIVITY_CONFIG.filter(
      (activity) => elapsedByActivity[activity.id] >= activity.goalMinutes * MS_PER_MINUTE,
    ).length;
  }, [elapsedByActivity]);

  const activeLabel =
    tracker.activeActivityId &&
    ACTIVITY_CONFIG.find((activity) => activity.id === tracker.activeActivityId)?.label;
  const dailyProgress = totalTrackedMs / (DAILY_TARGET_MINUTES * MS_PER_MINUTE);

  const handleActivityTap = useCallback((activityId: ActivityId) => {
    const now = Date.now();
    setNowMs(now);
    setTracker((previous) => {
      const today = getTodayKey(new Date(now));
      const base =
        previous.dayKey === today ? previous : createDefaultState(today);
      const elapsedMs = { ...base.elapsedMs };

      if (base.activeActivityId && base.activeSinceMs) {
        elapsedMs[base.activeActivityId] += Math.max(0, now - base.activeSinceMs);
      }

      if (base.activeActivityId === activityId) {
        return {
          ...base,
          elapsedMs,
          activeActivityId: null,
          activeSinceMs: null,
        };
      }

      return {
        ...base,
        elapsedMs,
        activeActivityId: activityId,
        activeSinceMs: now,
      };
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#090b0f] text-[#edf1f5]">
      <main className="mx-auto flex w-full max-w-[390px] flex-col gap-4 px-4 pb-28 pt-4 sm:max-w-3xl sm:px-6 lg:max-w-5xl lg:gap-6 lg:px-10">
        <section className="rounded-3xl border border-white/10 bg-[#11151b] px-5 py-5 shadow-[0_30px_70px_-45px_rgba(0,0,0,0.9)]">
          <p className="text-[0.66rem] uppercase tracking-[0.25em] text-white/45">
            TapAct
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[1.55rem] font-semibold tracking-tight text-white">
                Everyday time, made intentional.
              </h1>
              <p className="mt-1 text-sm text-white/55">
                Tap once to run. Tap again to pause.
              </p>
            </div>
            <div className="shrink-0 rounded-full border border-white/12 bg-[#191f29] p-2 text-white/70">
              <Timer className="size-5" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-white/50">Daily Progress</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatPercent(dailyProgress)}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-white/50">Goals Completed</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {goalsCompleted}/{ACTIVITY_CONFIG.length}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-white/50">Tracked Today</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatSummaryDuration(totalTrackedMs)}
              </p>
            </article>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
          <article className="rounded-3xl border border-white/10 bg-[#11151b] px-4 py-5 sm:px-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-white/70">Today Overview</h2>
              <span className="text-xs text-white/45">{tracker.dayKey}</span>
            </div>
            <div className="mt-4 grid place-items-center">
              <ProgressRing progress={dailyProgress} accent="#9BA5B4">
                <p className="text-[0.63rem] uppercase tracking-[0.2em] text-white/45">
                  Total
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                  {formatClock(totalTrackedMs)}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Target {DAILY_TARGET_MINUTES}m
                </p>
              </ProgressRing>
            </div>
            <AnimatePresence initial={false}>
              <motion.div
                key={activeLabel ?? "idle"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-2 text-sm"
              >
                {activeLabel ? (
                  <span className="text-white/75">
                    Active now:{" "}
                    <span className="font-medium text-white">{activeLabel}</span>
                  </span>
                ) : (
                  <span className="text-white/55">No active activity</span>
                )}
              </motion.div>
            </AnimatePresence>
          </article>

          <section
            aria-label="Activity controls"
            className="grid gap-3"
          >
            {ACTIVITY_CONFIG.map((activity) => {
              const isActive = tracker.activeActivityId === activity.id;
              const elapsedMs = elapsedByActivity[activity.id];
              const goalMs = activity.goalMinutes * MS_PER_MINUTE;
              const ratio = elapsedMs / goalMs;
              const ActivityIcon = activity.icon;

              return (
                <motion.button
                  key={activity.id}
                  type="button"
                  onClick={() => handleActivityTap(activity.id)}
                  aria-pressed={isActive}
                  whileTap={{ scale: 0.985 }}
                  className="rounded-3xl border bg-[#11151b] px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090b0f]"
                  style={{
                    borderColor: isActive ? activity.accent : "rgba(255,255,255,0.12)",
                    boxShadow: isActive
                      ? `0 16px 36px -26px ${activity.accent}`
                      : "none",
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="rounded-2xl border border-white/10 p-2.5"
                      style={{ color: activity.accent, background: "rgba(255,255,255,0.03)" }}
                    >
                      <ActivityIcon className="size-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate text-base font-semibold text-white">
                          {activity.label}
                        </h3>
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={isActive ? "running" : "paused"}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.2 }}
                            className="rounded-full border px-2 py-0.5 text-[0.67rem] uppercase tracking-[0.16em]"
                            style={{
                              color: isActive ? activity.accent : "rgba(255,255,255,0.66)",
                              borderColor: isActive
                                ? activity.accent
                                : "rgba(255,255,255,0.15)",
                              background: isActive
                                ? "rgba(255,255,255,0.05)"
                                : "rgba(255,255,255,0.02)",
                            }}
                          >
                            {isActive ? "Running" : "Paused"}
                          </motion.span>
                        </AnimatePresence>
                      </div>
                      <p className="mt-0.5 text-xs text-white/50">{activity.description}</p>
                      <p className="mt-2 text-sm font-medium tabular-nums text-white/90">
                        {formatClock(elapsedMs)}
                      </p>
                    </div>

                    <ProgressRing progress={ratio} accent={activity.accent} size={58} stroke={6}>
                      <span className="text-[0.64rem] font-medium text-white/80">
                        {formatPercent(ratio)}
                      </span>
                    </ProgressRing>
                  </div>
                </motion.button>
              );
            })}
          </section>
        </section>

        {!hydrated && (
          <p className="text-center text-xs text-white/45">
            Syncing your latest local session…
          </p>
        )}
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0e1218]/95 backdrop-blur"
      >
        <div className="mx-auto grid w-full max-w-[390px] grid-cols-4 gap-2 px-3 py-2 sm:max-w-3xl lg:max-w-5xl">
          {[
            { label: "Home", icon: House, active: true },
            { label: "Insights", icon: LineChart, active: false },
            { label: "History", icon: CheckCircle2, active: false },
            { label: "Settings", icon: Settings2, active: false },
          ].map((item) => {
            const NavIcon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                aria-current={item.active ? "page" : undefined}
                className="group rounded-2xl border border-white/10 px-2 py-2 text-center transition-colors hover:border-white/20 disabled:cursor-not-allowed"
                disabled={!item.active}
              >
                <NavIcon
                  className={`mx-auto size-4 ${
                    item.active ? "text-white" : "text-white/45"
                  }`}
                />
                <p className="mt-1 text-[0.68rem] font-medium tracking-wide text-white/90">
                  {item.label}
                </p>
                {!item.active && (
                  <p className="text-[0.58rem] uppercase tracking-[0.14em] text-white/45">
                    Coming soon
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
