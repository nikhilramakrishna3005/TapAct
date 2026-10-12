"use client";

import { AnimatePresence, motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  Code2,
  Dumbbell,
  Globe2,
  HeartPulse,
  House,
  Languages,
  LineChart,
  MessageSquare,
  Music2,
  Palette,
  PenLine,
  Plus,
  Settings2,
  Sparkles,
  PencilLine,
  Archive,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  addActivity,
  archiveActivity,
  createActivityId,
  createDefaultTrackerState,
  getDayKeyForMs,
  getDayTotalElapsed,
  getElapsedByActivityForDay,
  loadTrackerState,
  MS_PER_MINUTE,
  processActiveTimer,
  serializeTrackerState,
  STORAGE_KEY_V3,
  toggleActivity,
  type Activity,
  type ActivityIconName,
  type TrackerState,
  updateActivity,
} from "@/lib/tracker";

const DEFAULT_ACTIVITY_GOAL = 45;
const TRACKED_TIME_CAP_MS = 8 * 60 * MS_PER_MINUTE;

const ICON_REGISTRY: Record<ActivityIconName, { label: string; icon: LucideIcon }> = {
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

const COLOR_OPTIONS = [
  "#8B95FF",
  "#4FD1A5",
  "#E0A6FF",
  "#7EC8F8",
  "#FFB47D",
  "#FFC86B",
  "#9DE582",
  "#B6BFCB",
];

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

function formatCompactHours(ms: number): string {
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes === 0 ? `${hours}h` : `${hours}.${Math.floor(minutes / 6)}h`;
  }
  return `${Math.max(totalMinutes, 0)}m`;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function Ring({
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

function MetricRing({
  label,
  value,
  caption,
  ratio,
  color,
}: {
  label: string;
  value: string;
  caption: string;
  ratio: number;
  color: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3 text-center">
      <p className="text-[0.62rem] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <div className="mt-2 grid place-items-center">
        <Ring size={90} stroke={7} ratio={ratio} color={color}>
          <p className="text-sm font-semibold text-white">{value}</p>
        </Ring>
      </div>
      <p className="mt-2 text-[0.67rem] text-white/50">{caption}</p>
    </article>
  );
}

export default function Home() {
  const [tracker, setTracker] = useState<TrackerState>(() => createDefaultTrackerState(Date.now()));
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [isManageSheetOpen, setIsManageSheetOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<ActivityIconName>("briefcase");
  const [draftColor, setDraftColor] = useState("#8B95FF");
  const [draftGoal, setDraftGoal] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [editActivityId, setEditActivityId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState<ActivityIconName>("briefcase");
  const [editColor, setEditColor] = useState("#8B95FF");
  const [editGoal, setEditGoal] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setTracker((previous) => processActiveTimer(previous, now));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        setNowMs(now);
        setTracker((previous) => processActiveTimer(previous, now));
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    try {
      setTracker(loadTrackerState(window.localStorage, now));
    } catch {
      setTracker(createDefaultTrackerState(now));
    } finally {
      setHydrated(true);
      setNowMs(now);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY_V3, serializeTrackerState(tracker));
  }, [hydrated, tracker]);

  useEffect(() => {
    if (!isAddSheetOpen && !isManageSheetOpen && !editActivityId) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editActivityId, isAddSheetOpen, isManageSheetOpen]);

  const todayKey = useMemo(() => getDayKeyForMs(nowMs), [nowMs]);
  const elapsedByActivity = useMemo(() => {
    return getElapsedByActivityForDay(tracker, todayKey);
  }, [todayKey, tracker]);

  const activeActivities = useMemo(
    () => tracker.activities.filter((activity) => activity.archivedAtMs === null),
    [tracker.activities],
  );
  const archivedActivities = useMemo(
    () => tracker.activities.filter((activity) => activity.archivedAtMs !== null),
    [tracker.activities],
  );

  const totalTrackedMs = useMemo(() => {
    return getDayTotalElapsed(tracker, todayKey);
  }, [todayKey, tracker]);

  const activitiesWithGoals = useMemo(
    () => activeActivities.filter((activity) => activity.goalMinutes && activity.goalMinutes > 0),
    [activeActivities],
  );

  const goalsCompleted = useMemo(() => {
    return activitiesWithGoals.filter((activity) => {
      const elapsed = elapsedByActivity[activity.id] ?? 0;
      return elapsed >= (activity.goalMinutes ?? 0) * MS_PER_MINUTE;
    }).length;
  }, [activitiesWithGoals, elapsedByActivity]);

  const dailyTargetMinutes = useMemo(() => {
    const totalGoalMinutes = activitiesWithGoals.reduce(
      (sum, activity) => sum + (activity.goalMinutes ?? 0),
      0,
    );
    return totalGoalMinutes > 0 ? totalGoalMinutes : 240;
  }, [activitiesWithGoals]);

  const dailyProgressRatio = totalTrackedMs / (dailyTargetMinutes * MS_PER_MINUTE);
  const goalsRatio =
    activitiesWithGoals.length === 0 ? 0 : goalsCompleted / activitiesWithGoals.length;
  const trackedTimeRatio = totalTrackedMs / TRACKED_TIME_CAP_MS;

  const activeActivity =
    tracker.activeActivityId === null
      ? null
      : tracker.activities.find((activity) => activity.id === tracker.activeActivityId) ?? null;
  const activeElapsedMs = activeActivity ? elapsedByActivity[activeActivity.id] ?? 0 : 0;

  const handleActivityTap = useCallback((activityId: string) => {
    const now = Date.now();
    setNowMs(now);
    setTracker((previous) => toggleActivity(previous, activityId, now));
  }, []);

  const resetAddForm = useCallback(() => {
    setDraftName("");
    setDraftIcon("briefcase");
    setDraftColor("#8B95FF");
    setDraftGoal("");
    setDraftError(null);
  }, []);

  const closeAddSheet = useCallback(() => {
    setIsAddSheetOpen(false);
    setDraftError(null);
  }, []);

  const closeManageSheet = useCallback(() => {
    setIsManageSheetOpen(false);
  }, []);

  const openEditSheet = useCallback((activity: Activity) => {
    setIsAddSheetOpen(false);
    setIsManageSheetOpen(false);
    setEditActivityId(activity.id);
    setEditName(activity.name);
    setEditIcon(activity.iconKey);
    setEditColor(activity.color);
    setEditGoal(activity.goalMinutes ? String(activity.goalMinutes) : "");
    setEditError(null);
  }, []);

  const closeEditSheet = useCallback(() => {
    setEditActivityId(null);
    setEditError(null);
  }, []);

  const handleArchiveActivity = useCallback(
    (activity: Activity) => {
      const confirmed = window.confirm(
        `Archive "${activity.name}"? It will be removed from active tracking, but historical time stays saved.`,
      );
      if (!confirmed) {
        return;
      }
      const now = Date.now();
      setNowMs(now);
      setTracker((previous) => archiveActivity(previous, activity.id, now));
      if (editActivityId === activity.id) {
        closeEditSheet();
      }
    },
    [closeEditSheet, editActivityId],
  );

  const handleAddActivity = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const name = draftName.trim();
      if (name.length < 2) {
        setDraftError("Activity name must be at least 2 characters.");
        return;
      }

      let goalMinutes: number | null = null;
      if (draftGoal.trim().length > 0) {
        const parsedGoal = Number(draftGoal);
        if (!Number.isFinite(parsedGoal) || parsedGoal <= 0 || parsedGoal > 1440) {
          setDraftError("Daily goal must be between 1 and 1440 minutes.");
          return;
        }
        goalMinutes = Math.round(parsedGoal);
      }

      setTracker((previous) => {
        const id = createActivityId(name);
        return addActivity(previous, {
          id,
          name: name.slice(0, 36),
          iconKey: draftIcon,
          color: draftColor,
          goalMinutes,
          cue: "Custom activity",
        });
      });

      closeAddSheet();
      resetAddForm();
    },
    [closeAddSheet, draftColor, draftGoal, draftIcon, draftName, resetAddForm],
  );

  const handleEditActivity = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editActivityId) {
        return;
      }

      const name = editName.trim();
      if (name.length < 2) {
        setEditError("Activity name must be at least 2 characters.");
        return;
      }

      let goalMinutes: number | null = null;
      if (editGoal.trim().length > 0) {
        const parsedGoal = Number(editGoal);
        if (!Number.isFinite(parsedGoal) || parsedGoal <= 0 || parsedGoal > 1440) {
          setEditError("Daily goal must be between 1 and 1440 minutes.");
          return;
        }
        goalMinutes = Math.round(parsedGoal);
      }

      setTracker((previous) =>
        updateActivity(previous, editActivityId, {
          name: name.slice(0, 36),
          iconKey: editIcon,
          color: editColor,
          goalMinutes,
        }),
      );
      closeEditSheet();
    },
    [closeEditSheet, editActivityId, editColor, editGoal, editIcon, editName],
  );

  return (
    <div className="min-h-screen bg-[#090b10] text-[#edf2f7]">
      <main className="mx-auto w-full max-w-[390px] px-4 pb-[122px] pt-3">
        <header className="rounded-[28px] border border-white/10 bg-[#11161e] px-4 py-4 shadow-[0_18px_50px_-34px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.63rem] uppercase tracking-[0.25em] text-white/50">TapAct</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">
                Make today intentional.
              </h1>
            </div>
            <div className="rounded-full border border-white/12 bg-white/[0.03] p-2 text-white/70">
              <Sparkles className="size-4" />
            </div>
          </div>

          <section className="mt-4 grid grid-cols-3 gap-2.5">
            <MetricRing
              label="Daily"
              value={`${Math.round(clampRatio(dailyProgressRatio) * 100)}%`}
              caption={`${formatSummaryDuration(totalTrackedMs)} / ${dailyTargetMinutes}m`}
              ratio={dailyProgressRatio}
              color="#99A8B8"
            />
            <MetricRing
              label="Goals"
              value={`${goalsCompleted}/${activitiesWithGoals.length || 0}`}
              caption={`${Math.max(activitiesWithGoals.length - goalsCompleted, 0)} remaining`}
              ratio={goalsRatio}
              color="#84D7B4"
            />
            <MetricRing
              label="Tracked"
              value={formatCompactHours(totalTrackedMs)}
              caption="of 8h focus cap"
              ratio={trackedTimeRatio}
              color="#9DA7FF"
            />
          </section>
        </header>

        <AnimatePresence initial={false}>
          {activeActivity && (
            <motion.section
              key={activeActivity.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="mt-3 rounded-2xl border border-white/10 bg-[#121822] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white/75">
                  Active: <span className="text-white">{activeActivity.name}</span>
                </p>
                <div className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-1 text-[0.63rem] uppercase tracking-[0.18em] text-white/70">
                  Running
                </div>
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                {formatClock(activeElapsedMs)}
              </p>
            </motion.section>
          )}
        </AnimatePresence>

        <section className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[1.05rem] font-semibold tracking-tight text-white">
              Today&apos;s Activities
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAddSheetOpen(false);
                  closeEditSheet();
                  setIsManageSheetOpen(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-[#141b25] px-3 text-sm font-medium text-white transition-colors hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090b10]"
              >
                <PencilLine className="size-4" />
                Manage
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsManageSheetOpen(false);
                  closeEditSheet();
                  setIsAddSheetOpen(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-[#141b25] px-3 text-sm font-medium text-white transition-colors hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090b10]"
              >
                <Plus className="size-4" />
                Add
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            {activeActivities.map((activity) => {
              const elapsedMs = elapsedByActivity[activity.id] ?? 0;
              const isActive = tracker.activeActivityId === activity.id;
              const statusLabel = isActive ? "Running" : elapsedMs > 0 ? "Paused" : "Ready";
              const ratio = activity.goalMinutes
                ? elapsedMs / (activity.goalMinutes * MS_PER_MINUTE)
                : elapsedMs / (DEFAULT_ACTIVITY_GOAL * MS_PER_MINUTE);
              const progress = clampRatio(ratio);
              const Icon = ICON_REGISTRY[activity.iconKey].icon;

              return (
                <motion.button
                  key={activity.id}
                  type="button"
                  whileTap={{ scale: 0.988 }}
                  onClick={() => handleActivityTap(activity.id)}
                  aria-pressed={isActive}
                  className="w-full rounded-[24px] border bg-[#11161e] px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090b10]"
                  style={{
                    borderColor: isActive ? activity.color : "rgba(255,255,255,0.11)",
                    boxShadow: isActive
                      ? `0 18px 44px -34px ${activity.color}`
                      : "0 14px 34px -34px rgba(0,0,0,0.9)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="rounded-2xl border border-white/10 p-3"
                        style={{
                          color: activity.color,
                          background: "rgba(255,255,255,0.03)",
                        }}
                      >
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold tracking-tight text-white">
                          {activity.name}
                        </p>
                        <p className="truncate text-xs text-white/55">{activity.cue}</p>
                      </div>
                    </div>
                    <div
                      className="rounded-full border px-2.5 py-1 text-[0.63rem] uppercase tracking-[0.16em]"
                      style={{
                        color: isActive ? activity.color : "rgba(255,255,255,0.66)",
                        borderColor: isActive ? activity.color : "rgba(255,255,255,0.16)",
                        background: isActive ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                      }}
                    >
                      {statusLabel}
                    </div>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <p className="text-2xl font-semibold tabular-nums tracking-tight text-white">
                      {formatClock(elapsedMs)}
                    </p>
                    <p className="text-xs text-white/55">
                      {activity.goalMinutes ? `Goal ${activity.goalMinutes}m` : "No goal set"}
                    </p>
                  </div>

                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: activity.color }}
                        initial={false}
                        animate={{ width: `${Math.max(progress * 100, 2)}%` }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[0.69rem] text-white/45">
                      <span>{Math.round(progress * 100)}% complete</span>
                      <span>{formatSummaryDuration(elapsedMs)}</span>
                    </div>
                  </div>
                </motion.button>
              );
            })}

            {activeActivities.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-white/15 bg-[#11161e] px-4 py-8 text-center text-sm text-white/60">
                No active activities. Add one to start tracking.
              </div>
            )}
          </div>
        </section>

        {!hydrated && (
          <p className="mt-3 text-center text-xs text-white/45">Syncing your local session…</p>
        )}
      </main>

      <nav className="pointer-events-none fixed inset-x-0 bottom-4 z-20">
        <div className="pointer-events-auto mx-auto grid w-[calc(100%-24px)] max-w-[360px] grid-cols-4 items-center gap-1 rounded-2xl border border-white/12 bg-[#0f141d]/95 px-2 py-2 shadow-[0_20px_40px_-28px_rgba(0,0,0,1)] backdrop-blur">
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
                disabled={!item.active}
                aria-current={item.active ? "page" : undefined}
                className="rounded-xl px-1.5 py-1.5 text-center disabled:cursor-not-allowed"
              >
                <NavIcon
                  className={`mx-auto size-4 ${
                    item.active ? "text-white" : "text-white/45"
                  }`}
                />
                <p className="mt-1 text-[0.64rem] font-medium tracking-[0.03em] text-white/88">
                  {item.label}
                </p>
                {!item.active && (
                  <p className="text-[0.54rem] uppercase tracking-[0.14em] text-white/45">
                    Soon
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <AnimatePresence>
        {isAddSheetOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeAddSheet}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="Add activity"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              onClick={(event) => event.stopPropagation()}
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[390px] rounded-t-[28px] border border-white/12 bg-[#121823] px-4 pb-5 pt-4 shadow-[0_-20px_44px_-30px_rgba(0,0,0,1)]"
            >
              <div className="mx-auto h-1.5 w-11 rounded-full bg-white/20" />
              <div className="mt-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight text-white">Add Activity</h3>
                <button
                  type="button"
                  onClick={closeAddSheet}
                  className="rounded-full border border-white/15 p-1.5 text-white/70 hover:text-white"
                  aria-label="Close add activity panel"
                >
                  <X className="size-4" />
                </button>
              </div>

              <form className="mt-3 space-y-3" onSubmit={handleAddActivity}>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/55">
                    Activity Name
                  </span>
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder="e.g. Meditation"
                    className="w-full rounded-xl border border-white/12 bg-[#0f141d] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  />
                </label>

                <div>
                  <p className="mb-1 text-xs uppercase tracking-[0.15em] text-white/55">Icon</p>
                  <div className="grid grid-cols-6 gap-2">
                    {Object.entries(ICON_REGISTRY).map(([key, config]) => {
                      const isSelected = draftIcon === key;
                      const Icon = config.icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setDraftIcon(key as ActivityIconName)}
                          className="rounded-xl border bg-[#0f141d] p-2 transition-colors"
                          style={{
                            borderColor: isSelected ? draftColor : "rgba(255,255,255,0.12)",
                            color: isSelected ? draftColor : "rgba(255,255,255,0.74)",
                          }}
                          aria-label={`Select ${config.label} icon`}
                        >
                          <Icon className="mx-auto size-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs uppercase tracking-[0.15em] text-white/55">Color</p>
                  <div className="grid grid-cols-8 gap-2">
                    {COLOR_OPTIONS.map((color) => {
                      const selected = color === draftColor;
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Select ${color} accent`}
                          onClick={() => setDraftColor(color)}
                          className="grid place-items-center rounded-full border p-[3px]"
                          style={{
                            borderColor: selected ? "white" : "rgba(255,255,255,0.14)",
                          }}
                        >
                          <span
                            className="block size-5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/55">
                    Daily Goal (minutes, optional)
                  </span>
                  <input
                    value={draftGoal}
                    onChange={(event) => setDraftGoal(event.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="30"
                    className="w-full rounded-xl border border-white/12 bg-[#0f141d] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  />
                </label>

                {draftError && <p className="text-xs text-[#FFB4B4]">{draftError}</p>}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      closeAddSheet();
                      resetAddForm();
                    }}
                    className="flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2.5 text-sm font-medium text-white/85"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl border border-white/10 bg-[#1b2532] px-3 py-2.5 text-sm font-semibold text-white"
                  >
                    Save Activity
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isManageSheetOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeManageSheet}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="Manage activities"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              onClick={(event) => event.stopPropagation()}
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[390px] rounded-t-[28px] border border-white/12 bg-[#121823] px-4 pb-5 pt-4 shadow-[0_-20px_44px_-30px_rgba(0,0,0,1)]"
            >
              <div className="mx-auto h-1.5 w-11 rounded-full bg-white/20" />
              <div className="mt-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight text-white">Manage Activities</h3>
                <button
                  type="button"
                  onClick={closeManageSheet}
                  className="rounded-full border border-white/15 p-1.5 text-white/70 hover:text-white"
                  aria-label="Close activity management panel"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3 max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                {activeActivities.map((activity) => {
                  const Icon = ICON_REGISTRY[activity.iconKey].icon;
                  return (
                    <article
                      key={activity.id}
                      className="rounded-2xl border border-white/12 bg-[#0f141d] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="rounded-xl border border-white/10 p-2.5"
                            style={{ color: activity.color, background: "rgba(255,255,255,0.03)" }}
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{activity.name}</p>
                            <p className="text-xs text-white/55">
                              {activity.goalMinutes ? `Goal ${activity.goalMinutes}m` : "No goal"}
                              {" · "}
                              {formatSummaryDuration(elapsedByActivity[activity.id] ?? 0)} today
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditSheet(activity)}
                            className="rounded-lg border border-white/15 px-2 py-1.5 text-xs text-white/80"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchiveActivity(activity)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#ff6d6d55] px-2 py-1.5 text-xs text-[#ffc0c0]"
                          >
                            <Archive className="size-3.5" />
                            Archive
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {activeActivities.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-sm text-white/55">
                    No active activities to manage.
                  </p>
                )}

                {archivedActivities.length > 0 && (
                  <div className="pt-2">
                    <p className="mb-2 text-xs uppercase tracking-[0.15em] text-white/50">
                      Archived
                    </p>
                    <div className="space-y-1.5">
                      {archivedActivities.map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
                        >
                          <p className="truncate text-sm text-white/72">{activity.name}</p>
                          <p className="text-[0.65rem] uppercase tracking-[0.14em] text-white/45">
                            Preserved
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editActivityId && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeEditSheet}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="Edit activity"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              onClick={(event) => event.stopPropagation()}
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[390px] rounded-t-[28px] border border-white/12 bg-[#121823] px-4 pb-5 pt-4 shadow-[0_-20px_44px_-30px_rgba(0,0,0,1)]"
            >
              <div className="mx-auto h-1.5 w-11 rounded-full bg-white/20" />
              <div className="mt-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight text-white">Edit Activity</h3>
                <button
                  type="button"
                  onClick={closeEditSheet}
                  className="rounded-full border border-white/15 p-1.5 text-white/70 hover:text-white"
                  aria-label="Close edit activity panel"
                >
                  <X className="size-4" />
                </button>
              </div>

              <form className="mt-3 space-y-3" onSubmit={handleEditActivity}>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/55">
                    Activity Name
                  </span>
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="w-full rounded-xl border border-white/12 bg-[#0f141d] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  />
                </label>

                <div>
                  <p className="mb-1 text-xs uppercase tracking-[0.15em] text-white/55">Icon</p>
                  <div className="grid grid-cols-6 gap-2">
                    {Object.entries(ICON_REGISTRY).map(([key, config]) => {
                      const isSelected = editIcon === key;
                      const Icon = config.icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEditIcon(key as ActivityIconName)}
                          className="rounded-xl border bg-[#0f141d] p-2 transition-colors"
                          style={{
                            borderColor: isSelected ? editColor : "rgba(255,255,255,0.12)",
                            color: isSelected ? editColor : "rgba(255,255,255,0.74)",
                          }}
                          aria-label={`Select ${config.label} icon`}
                        >
                          <Icon className="mx-auto size-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs uppercase tracking-[0.15em] text-white/55">Color</p>
                  <div className="grid grid-cols-8 gap-2">
                    {COLOR_OPTIONS.map((color) => {
                      const selected = color === editColor;
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Select ${color} accent`}
                          onClick={() => setEditColor(color)}
                          className="grid place-items-center rounded-full border p-[3px]"
                          style={{
                            borderColor: selected ? "white" : "rgba(255,255,255,0.14)",
                          }}
                        >
                          <span
                            className="block size-5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/55">
                    Daily Goal (minutes, optional)
                  </span>
                  <input
                    value={editGoal}
                    onChange={(event) => setEditGoal(event.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="30"
                    className="w-full rounded-xl border border-white/12 bg-[#0f141d] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  />
                </label>

                {editError && <p className="text-xs text-[#FFB4B4]">{editError}</p>}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeEditSheet}
                    className="flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2.5 text-sm font-medium text-white/85"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl border border-white/10 bg-[#1b2532] px-3 py-2.5 text-sm font-semibold text-white"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
