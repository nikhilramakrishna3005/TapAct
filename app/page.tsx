"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  CalendarDays,
  Check,
  House,
  LineChart,
  PencilLine,
  Plus,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DURATION, EASE_OUT, SPRING_SHEET, SPRING_SNAPPY } from "@/lib/motion";
import { applyStarterActivities, type StarterActivity } from "@/lib/onboarding";
import { shouldShowOnboarding } from "@/lib/preferences";
import {
  addActivity,
  archiveActivity,
  createActivityId,
  createDefaultTrackerState,
  getDayKeyForMs,
  getDayTotalElapsed,
  getElapsedByActivityForDay,
  MS_PER_MINUTE,
  processActiveTimer,
  STORAGE_KEY_V3,
  toggleActivity,
  type Activity,
  type ActivityIconName,
  type TrackerState,
  updateActivity,
} from "@/lib/tracker";
import {
  commitTrackerUpdate,
  syncFromStorage,
  type PersistFailureReason,
  type TrackerUpdate,
  type WritableStorageLike,
} from "@/lib/trackerStore";
import { getInitials } from "@/lib/auth/account";
import { recordCommit, SYNC_DIRTY_EVENT } from "@/lib/sync/capture";
import { ActivityCard } from "./components/ActivityCard";
import { AuthProvider, useAuth } from "./components/AuthProvider";
import { CloudSyncProvider } from "./components/CloudSync";
import { HistoryView } from "./components/HistoryView";
import { InsightsView } from "./components/InsightsView";
import { MotionPrefsProvider, useMotionPrefs } from "./components/MotionPrefs";
import { Onboarding } from "./components/Onboarding";
import { DayOrbit, OrbitMark } from "./components/Orbit";
import { SettingsView } from "./components/SettingsView";
import {
  clampRatio,
  COLOR_OPTIONS,
  formatClock,
  formatCompactHours,
  formatSummaryDuration,
  ICON_REGISTRY,
  StatTile,
  tint,
} from "./components/ui";

function getBrowserStorage(): WritableStorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const TRACKED_TIME_CAP_MS = 8 * 60 * MS_PER_MINUTE;
const MILESTONE_VISIBLE_MS = 3600;

type Tab = "home" | "insights" | "history" | "settings";
type OnboardingPhase = "pending" | "show" | "done";

type Milestone = {
  key: number;
  title: string;
  body: string;
  color: string;
  all: boolean;
};

const NAV_ITEMS = [
  { id: "home", label: "Today", icon: House },
  { id: "insights", label: "Insights", icon: LineChart },
  { id: "history", label: "History", icon: CalendarDays },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

type ActivityDraft = {
  name: string;
  icon: ActivityIconName;
  color: string;
  goal: string;
};

const EMPTY_DRAFT: ActivityDraft = { name: "", icon: "briefcase", color: COLOR_OPTIONS[0], goal: "" };

function validateDraft(draft: ActivityDraft): { error: string } | { name: string; goalMinutes: number | null } {
  const name = draft.name.trim();
  if (name.length < 2) {
    return { error: "Activity name must be at least 2 characters." };
  }
  if (draft.goal.trim().length === 0) {
    return { name, goalMinutes: null };
  }
  const parsedGoal = Number(draft.goal);
  if (!Number.isFinite(parsedGoal) || parsedGoal <= 0 || parsedGoal > 1440) {
    return { error: "Daily goal must be between 1 and 1440 minutes." };
  }
  return { name, goalMinutes: Math.round(parsedGoal) };
}

function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-30 bg-black/70"
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

function ActivityForm({
  draft,
  setDraft,
  error,
  submitLabel,
  onSubmit,
  onCancel,
  footer,
}: {
  draft: ActivityDraft;
  setDraft: (update: (draft: ActivityDraft) => ActivityDraft) => void;
  error: string | null;
  submitLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  footer?: React.ReactNode;
}) {
  const PreviewIcon = ICON_REGISTRY[draft.icon].icon;
  return (
    <form className="mt-4 space-y-4" onSubmit={onSubmit}>
      <div className="flex items-center gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-2xl transition-colors"
          style={{ color: draft.color, background: tint(draft.color, 0.14) }}
          aria-hidden="true"
        >
          <PreviewIcon className="size-5" />
        </span>
        <label className="block flex-1">
          <span className="eyebrow mb-1.5 block">Activity name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. Meditation"
            maxLength={36}
            className="field"
          />
        </label>
      </div>

      <div>
        <p className="eyebrow mb-2">Icon</p>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(ICON_REGISTRY).map(([key, config]) => {
            const isSelected = draft.icon === key;
            const Icon = config.icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, icon: key as ActivityIconName }))}
                aria-pressed={isSelected}
                className="grid min-h-11 place-items-center rounded-xl border transition-colors"
                style={{
                  borderColor: isSelected ? draft.color : "var(--line)",
                  background: isSelected ? tint(draft.color, 0.12) : "var(--ink-0)",
                  color: isSelected ? draft.color : "var(--text-2)",
                }}
                aria-label={`Select ${config.label} icon`}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="eyebrow mb-2">Color</p>
        <div className="grid grid-cols-8 gap-2">
          {COLOR_OPTIONS.map((color) => {
            const selected = color === draft.color;
            return (
              <button
                key={color}
                type="button"
                aria-label={`Select ${color} accent`}
                aria-pressed={selected}
                onClick={() => setDraft((current) => ({ ...current, color }))}
                className="grid aspect-square min-h-9 place-items-center rounded-full border-2 transition-colors"
                style={{ borderColor: selected ? color : "transparent" }}
              >
                <span className="block size-6 rounded-full" style={{ backgroundColor: color }} />
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Daily goal · minutes (optional)</span>
        <input
          value={draft.goal}
          onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="30"
          className="field"
        />
      </label>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn btn-ghost h-12 flex-1">
          Cancel
        </button>
        <button type="submit" className="btn btn-primary h-12 flex-1">
          {submitLabel}
        </button>
      </div>
      {footer}
    </form>
  );
}

function MilestoneToast({ milestone, expressive }: { milestone: Milestone; expressive: boolean }) {
  return (
    <motion.div
      key={milestone.key}
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={SPRING_SNAPPY}
      className="glass pointer-events-auto mx-auto flex w-[calc(100%-24px)] max-w-[366px] items-center gap-3 rounded-[22px] px-3.5 py-3 shadow-[0_24px_50px_-28px_rgba(0,0,0,1)]"
      style={{ borderColor: tint(milestone.color, 0.45) }}
    >
      <span className="relative grid size-10 shrink-0 place-items-center">
        {expressive &&
          [0, 1].map((ring) => (
            <motion.span
              key={ring}
              aria-hidden="true"
              className="absolute inset-0 rounded-full border"
              style={{ borderColor: milestone.color }}
              initial={{ scale: 0.6, opacity: 0.9 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 0.9, delay: ring * 0.18, ease: EASE_OUT }}
            />
          ))}
        <motion.span
          className="grid size-10 place-items-center rounded-full"
          style={{ background: milestone.color }}
          initial={{ scale: 0.4 }}
          animate={{ scale: 1 }}
          transition={{ ...SPRING_SNAPPY, delay: 0.05 }}
        >
          {milestone.all ? (
            <OrbitMark size={22} />
          ) : (
            <Check className="size-5 text-ink-0" strokeWidth={3} />
          )}
        </motion.span>
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-text-1">{milestone.title}</p>
        <p className="truncate text-xs text-text-2">{milestone.body}</p>
      </div>
    </motion.div>
  );
}

function formatTodayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function Page() {
  return (
    <MotionPrefsProvider>
      <AuthProvider>
        <Home />
      </AuthProvider>
    </MotionPrefsProvider>
  );
}

function Home() {
  const { expressive, setPreferences } = useMotionPrefs();
  const auth = useAuth();
  const [tracker, setTracker] = useState<TrackerState>(() => createDefaultTrackerState(Date.now()));
  const trackerRef = useRef<TrackerState | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [hydrated, setHydrated] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingPhase>("pending");
  const [tab, setTab] = useState<Tab>("home");
  const [persistFailure, setPersistFailure] = useState<PersistFailureReason | null>(null);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const metGoalsRef = useRef<{ dayKey: string; ids: Set<string> } | null>(null);

  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [isManageSheetOpen, setIsManageSheetOpen] = useState(false);
  const [draft, setDraft] = useState<ActivityDraft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [editActivityId, setEditActivityId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ActivityDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState<string | null>(null);

  const commit = useCallback((update: TrackerUpdate, options?: { source?: "sync" }) => {
    const now = Date.now();
    const storage = getBrowserStorage();
    const result = commitTrackerUpdate(storage, trackerRef.current, update, now);
    const fromSync = options?.source === "sync";
    if (recordCommit(storage, result.base, result.state, now, { captureActivities: !fromSync }) && !fromSync) {
      window.dispatchEvent(new Event(SYNC_DIRTY_EVENT));
    }
    trackerRef.current = result.state;
    setTracker(result.state);
    setNowMs(now);
    setPersistFailure(result.failureReason);
    return result;
  }, []);

  const syncWithOtherTabs = useCallback(() => {
    const now = Date.now();
    const next = syncFromStorage(getBrowserStorage(), trackerRef.current, now);
    trackerRef.current = next;
    setTracker(next);
    setNowMs(now);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY_V3) {
        syncWithOtherTabs();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncWithOtherTabs();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncWithOtherTabs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncWithOtherTabs);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncWithOtherTabs]);

  useEffect(() => {
    // Decide before the first write: persisting below creates the v3 key that marks a returning user.
    const firstLaunch = shouldShowOnboarding(getBrowserStorage());
    // Persisting on load also completes any v1/v2 migration into the v3 key.
    commit((base) => base);
    setHydrated(true);
    setOnboarding(firstLaunch ? "show" : "done");
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === "settings") {
      setTab("settings");
      url.searchParams.delete("tab");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [commit]);

  useEffect(() => {
    if (!isAddSheetOpen && !isManageSheetOpen && !editActivityId && onboarding !== "show") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editActivityId, isAddSheetOpen, isManageSheetOpen, onboarding]);

  const todayKey = useMemo(() => getDayKeyForMs(nowMs), [nowMs]);
  const liveTracker = useMemo(() => processActiveTimer(tracker, nowMs), [nowMs, tracker]);
  const elapsedByActivity = useMemo(() => {
    return getElapsedByActivityForDay(liveTracker, todayKey);
  }, [liveTracker, todayKey]);

  const activeActivities = useMemo(
    () => tracker.activities.filter((activity) => activity.archivedAtMs === null),
    [tracker.activities],
  );
  const archivedActivities = useMemo(
    () => tracker.activities.filter((activity) => activity.archivedAtMs !== null),
    [tracker.activities],
  );

  const totalTrackedMs = useMemo(() => {
    return getDayTotalElapsed(liveTracker, todayKey);
  }, [liveTracker, todayKey]);

  const activitiesWithGoals = useMemo(
    () => activeActivities.filter((activity) => activity.goalMinutes && activity.goalMinutes > 0),
    [activeActivities],
  );

  const metGoalIds = useMemo(
    () =>
      activitiesWithGoals
        .filter((activity) => {
          const elapsed = elapsedByActivity[activity.id] ?? 0;
          return elapsed >= (activity.goalMinutes ?? 0) * MS_PER_MINUTE;
        })
        .map((activity) => activity.id),
    [activitiesWithGoals, elapsedByActivity],
  );
  const goalsCompleted = metGoalIds.length;
  const metGoalKey = metGoalIds.join("|");

  const dailyTargetMinutes = useMemo(() => {
    const totalGoalMinutes = activitiesWithGoals.reduce(
      (sum, activity) => sum + (activity.goalMinutes ?? 0),
      0,
    );
    return totalGoalMinutes > 0 ? totalGoalMinutes : 240;
  }, [activitiesWithGoals]);

  const dailyProgressRatio = totalTrackedMs / (dailyTargetMinutes * MS_PER_MINUTE);
  const allGoalsMet = activitiesWithGoals.length > 0 && goalsCompleted === activitiesWithGoals.length;

  const activeActivity =
    tracker.activeActivityId === null
      ? null
      : tracker.activities.find((activity) => activity.id === tracker.activeActivityId) ?? null;
  const activeElapsedMs = activeActivity ? elapsedByActivity[activeActivity.id] ?? 0 : 0;
  const sessionMs =
    activeActivity && tracker.activeSinceMs !== null ? Math.max(0, nowMs - tracker.activeSinceMs) : 0;

  // Celebrate only goals crossed live by the running timer, never ones loaded, imported, or synced in.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const ids = metGoalKey ? metGoalKey.split("|") : [];
    const previous = metGoalsRef.current;
    metGoalsRef.current = { dayKey: todayKey, ids: new Set(ids) };
    if (!previous || previous.dayKey !== todayKey) {
      return;
    }
    const crossed = ids.find((id) => !previous.ids.has(id) && id === tracker.activeActivityId);
    if (!crossed) {
      return;
    }
    const activity = tracker.activities.find((item) => item.id === crossed);
    if (!activity) {
      return;
    }
    const all = ids.length === activitiesWithGoals.length;
    setMilestone({
      key: Date.now(),
      title: all ? "Orbit complete" : `${activity.name} goal reached`,
      body: all
        ? "Every daily goal is done. Beautiful work."
        : `${activity.goalMinutes}m done today · ${ids.length}/${activitiesWithGoals.length} goals`,
      color: all ? "#6CF2C2" : activity.color,
      all,
    });
  }, [activitiesWithGoals.length, hydrated, metGoalKey, todayKey, tracker.activeActivityId, tracker.activities]);

  useEffect(() => {
    if (!milestone) {
      return;
    }
    const timeoutId = window.setTimeout(() => setMilestone(null), MILESTONE_VISIBLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [milestone]);

  const handleActivityTap = useCallback(
    (activityId: string) => {
      commit((base, now) => toggleActivity(base, activityId, now));
    },
    [commit],
  );

  const handleOnboardingFinish = useCallback(
    (starters: StarterActivity[] | null) => {
      if (starters && starters.length > 0) {
        commit((base, now) => applyStarterActivities(base, starters, now));
      }
      setPreferences({ onboardingCompletedAtMs: Date.now() });
      setOnboarding("done");
      setTab("home");
    },
    [commit, setPreferences],
  );

  const resetAddForm = useCallback(() => {
    setDraft(EMPTY_DRAFT);
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
    setEditDraft({
      name: activity.name,
      icon: activity.iconKey,
      color: activity.color,
      goal: activity.goalMinutes ? String(activity.goalMinutes) : "",
    });
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
      commit((base, now) => archiveActivity(base, activity.id, now));
      if (editActivityId === activity.id) {
        closeEditSheet();
      }
    },
    [closeEditSheet, commit, editActivityId],
  );

  const handleAddActivity = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const result = validateDraft(draft);
      if ("error" in result) {
        setDraftError(result.error);
        return;
      }
      const id = createActivityId(result.name);
      commit((base) =>
        addActivity(base, {
          id,
          name: result.name.slice(0, 36),
          iconKey: draft.icon,
          color: draft.color,
          goalMinutes: result.goalMinutes,
          cue: "Custom activity",
        }),
      );
      closeAddSheet();
      resetAddForm();
    },
    [closeAddSheet, commit, draft, resetAddForm],
  );

  const handleEditActivity = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editActivityId) {
        return;
      }
      const result = validateDraft(editDraft);
      if ("error" in result) {
        setEditError(result.error);
        return;
      }
      commit((base) =>
        updateActivity(base, editActivityId, {
          name: result.name.slice(0, 36),
          iconKey: editDraft.icon,
          color: editDraft.color,
          goalMinutes: result.goalMinutes,
        }),
      );
      closeEditSheet();
    },
    [closeEditSheet, commit, editActivityId, editDraft],
  );

  const editingActivity = editActivityId
    ? tracker.activities.find((activity) => activity.id === editActivityId) ?? null
    : null;

  const orbitSegments = activeActivities.map((activity) => ({
    id: activity.id,
    color: activity.color,
    ms: elapsedByActivity[activity.id] ?? 0,
  }));
  const archivedTodayMs = archivedActivities.reduce((sum, activity) => sum + (elapsedByActivity[activity.id] ?? 0), 0);
  if (archivedTodayMs > 0) {
    orbitSegments.push({ id: "__archived", color: "#5b5b6b", ms: archivedTodayMs });
  }

  return (
    <CloudSyncProvider commit={commit} tracker={tracker}>
    <div className="min-h-screen text-text-1">
      <motion.main
        className="mx-auto w-full max-w-[430px] px-5 pb-[calc(124px+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]"
        initial={false}
        animate={{ opacity: onboarding === "pending" ? 0 : 1 }}
        transition={{ duration: DURATION.instant }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DURATION.quick, ease: EASE_OUT }}
          >
            {tab === "insights" ? (
              <InsightsView tracker={liveTracker} todayKey={todayKey} />
            ) : tab === "history" ? (
              <HistoryView tracker={liveTracker} todayKey={todayKey} />
            ) : tab === "settings" ? (
              <SettingsView
                tracker={tracker}
                commit={commit}
                getStorage={getBrowserStorage}
                persistFailure={persistFailure}
              />
            ) : (
              <>
                <header className="flex h-12 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <OrbitMark size={26} spin={activeActivity !== null} />
                    <span className="text-[1.05rem] font-semibold tracking-[-0.03em]">TapAct</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-text-3">{formatTodayLabel(nowMs)}</p>
                    {auth.status !== "unavailable" && (
                      <button
                        type="button"
                        onClick={() => {
                          setTab("settings");
                          window.scrollTo({ top: 0 });
                        }}
                        aria-label={auth.account ? "Account settings" : "Sign in or create an account"}
                        className="-mr-1.5 grid size-11 place-items-center rounded-full"
                      >
                        {auth.account ? (
                          <span className="grid size-8 place-items-center rounded-full bg-[linear-gradient(135deg,var(--volt),var(--ice))] text-[0.7rem] font-bold text-ink-0">
                            {getInitials(auth.account)}
                          </span>
                        ) : (
                          <span className="grid size-8 place-items-center rounded-full border border-line-strong text-text-2">
                            <UserRound className="size-4" />
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </header>

                {persistFailure && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-3 rounded-2xl border border-ember/30 bg-ember/[0.07] px-3 py-2.5 text-xs text-[#FFD3B0]"
                  >
                    {persistFailure === "quota"
                      ? "Browser storage is full. Recent tracking changes aren't saved on this device."
                      : "Browser storage is unavailable. Recent tracking changes aren't saved on this device."}
                  </p>
                )}

                <section aria-label="Today's progress" className="mt-4">
                  <DayOrbit
                    segments={orbitSegments}
                    targetMs={dailyTargetMinutes * MS_PER_MINUTE}
                    satellites={activitiesWithGoals.map((activity) => ({
                      id: activity.id,
                      color: activity.color,
                      label: activity.name,
                      met: metGoalIds.includes(activity.id),
                    }))}
                    runningColor={activeActivity?.color ?? null}
                    complete={allGoalsMet}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {activeActivity ? (
                        <motion.div
                          key={`run-${activeActivity.id}`}
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: DURATION.base, ease: EASE_OUT }}
                          className="px-10"
                        >
                          <p
                            className="inline-flex max-w-[150px] items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em]"
                            style={{ color: activeActivity.color }}
                          >
                            <span
                              className="ambient-pulse size-1.5 shrink-0 rounded-full"
                              style={{ background: activeActivity.color }}
                            />
                            <span className="truncate">{activeActivity.name}</span>
                          </p>
                          <p className="numeric mt-1.5 text-[2.35rem] font-semibold leading-none">
                            {formatClock(sessionMs)}
                          </p>
                          <p className="mt-2 text-[0.7rem] text-text-3">
                            this session · {formatSummaryDuration(activeElapsedMs)} today
                          </p>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="idle"
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: DURATION.base, ease: EASE_OUT }}
                        >
                          <p className="eyebrow">{allGoalsMet ? "Orbit complete" : "Today"}</p>
                          <p className="numeric mt-1.5 text-[2.6rem] font-semibold leading-none">
                            {formatSummaryDuration(totalTrackedMs)}
                          </p>
                          <p className="mt-2 text-[0.7rem] text-text-3">
                            {totalTrackedMs === 0
                              ? "Tap an activity to begin"
                              : `of ${formatSummaryDuration(dailyTargetMinutes * MS_PER_MINUTE)} daily target`}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </DayOrbit>

                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <StatTile
                      label="Daily"
                      value={`${Math.round(clampRatio(dailyProgressRatio) * 100)}%`}
                      accent="#8E7BFF"
                    />
                    <StatTile
                      label="Goals"
                      value={`${goalsCompleted}/${activitiesWithGoals.length || 0}`}
                      accent="#6CF2C2"
                      emphasis={allGoalsMet}
                    />
                    <StatTile
                      label="Of 8h cap"
                      value={formatCompactHours(Math.min(totalTrackedMs, TRACKED_TIME_CAP_MS))}
                      accent="#5FE3FF"
                    />
                  </div>
                </section>

                <section className="mt-8" aria-labelledby="activities-heading">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="eyebrow">{activeActivities.length} active</p>
                      <h2 id="activities-heading" className="display mt-1.5 text-[1.5rem]">
                        Activities
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddSheetOpen(false);
                          closeEditSheet();
                          setIsManageSheetOpen(true);
                        }}
                        className="btn btn-ghost !min-h-10 !px-3.5"
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
                        className="btn btn-primary !min-h-10 !px-3.5"
                      >
                        <Plus className="size-4" />
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {activeActivities.map((activity) => (
                      <ActivityCard
                        key={activity.id}
                        activity={activity}
                        elapsedMs={elapsedByActivity[activity.id] ?? 0}
                        isActive={tracker.activeActivityId === activity.id}
                        activeSinceMs={tracker.activeActivityId === activity.id ? tracker.activeSinceMs : null}
                        onToggle={() => handleActivityTap(activity.id)}
                        onEdit={() => openEditSheet(activity)}
                      />
                    ))}

                    {activeActivities.length === 0 && (
                      <div className="rounded-[var(--radius-lg)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-2">
                        No active activities. Add one to start tracking.
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {!hydrated && (
          <p className="mt-3 text-center text-xs text-text-3">Syncing your local session…</p>
        )}
      </motion.main>

      <div className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-40">
        <AnimatePresence>
          {milestone && <MilestoneToast key={milestone.key} milestone={milestone} expressive={expressive} />}
        </AnimatePresence>
      </div>

      <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-[calc(0.9rem+env(safe-area-inset-bottom))] z-20">
        <div className="glass pointer-events-auto mx-auto grid w-[calc(100%-24px)] max-w-[380px] grid-cols-4 items-center gap-1 rounded-[26px] p-1.5 shadow-[0_24px_48px_-24px_rgba(0,0,0,1)]">
          {NAV_ITEMS.map((item) => {
            const NavIcon = item.icon;
            const isCurrent = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!isCurrent) {
                    setTab(item.id);
                    window.scrollTo({ top: 0 });
                  }
                }}
                aria-current={isCurrent ? "page" : undefined}
                className="relative min-h-[52px] rounded-[20px] px-1.5 py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
              >
                {isCurrent && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-[20px] bg-white/[0.08]"
                    transition={SPRING_SNAPPY}
                  >
                    <span className="absolute left-1/2 top-1 h-[3px] w-4 -translate-x-1/2 rounded-full bg-volt" />
                  </motion.span>
                )}
                <NavIcon
                  className={`relative mx-auto size-[18px] transition-colors ${
                    isCurrent ? "text-text-1" : "text-text-3"
                  }`}
                />
                <p
                  className={`relative mt-1 text-[0.66rem] font-medium tracking-[0.02em] transition-colors ${
                    isCurrent ? "text-text-1" : "text-text-3"
                  }`}
                >
                  {item.label}
                </p>
              </button>
            );
          })}
        </div>
      </nav>

      <AnimatePresence>
        {isAddSheetOpen && (
          <Sheet label="Add activity" onClose={closeAddSheet}>
            <ActivityForm
              draft={draft}
              setDraft={setDraft}
              error={draftError}
              submitLabel="Save activity"
              onSubmit={handleAddActivity}
              onCancel={() => {
                closeAddSheet();
                resetAddForm();
              }}
            />
          </Sheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isManageSheetOpen && (
          <Sheet label="Manage activities" onClose={closeManageSheet}>
            <div className="mt-4 max-h-[62vh] space-y-2 overflow-y-auto pr-1">
              {activeActivities.map((activity) => {
                const Icon = ICON_REGISTRY[activity.iconKey].icon;
                return (
                  <article key={activity.id} className="rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="grid size-10 shrink-0 place-items-center rounded-xl"
                          style={{ color: activity.color, background: tint(activity.color, 0.13) }}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text-1">{activity.name}</p>
                          <p className="text-xs text-text-3">
                            {activity.goalMinutes ? `Goal ${activity.goalMinutes}m` : "No goal"}
                            {" · "}
                            {formatSummaryDuration(elapsedByActivity[activity.id] ?? 0)} today
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditSheet(activity)}
                          className="min-h-10 rounded-full border border-line-strong px-3 text-xs font-medium text-text-1"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchiveActivity(activity)}
                          className="inline-flex min-h-10 items-center gap-1 rounded-full border border-danger/35 px-3 text-xs font-medium text-[#FFC4C4]"
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
                <p className="rounded-xl border border-dashed border-line-strong px-3 py-4 text-center text-sm text-text-2">
                  No active activities to manage.
                </p>
              )}

              {archivedActivities.length > 0 && (
                <div className="pt-3">
                  <p className="eyebrow mb-2">Archived</p>
                  <div className="space-y-1.5">
                    {archivedActivities.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5"
                      >
                        <p className="truncate text-sm text-text-2">{activity.name}</p>
                        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-3">
                          History kept
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Sheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editActivityId && (
          <Sheet label="Edit activity" onClose={closeEditSheet}>
            <ActivityForm
              draft={editDraft}
              setDraft={setEditDraft}
              error={editError}
              submitLabel="Save changes"
              onSubmit={handleEditActivity}
              onCancel={closeEditSheet}
              footer={
                editingActivity && editingActivity.archivedAtMs === null ? (
                  <button
                    type="button"
                    onClick={() => handleArchiveActivity(editingActivity)}
                    className="mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-xs font-medium text-[#FFC4C4]"
                  >
                    <Archive className="size-3.5" />
                    Archive this activity
                  </button>
                ) : null
              }
            />
          </Sheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {onboarding === "show" && <Onboarding key="onboarding" onFinish={handleOnboardingFinish} />}
      </AnimatePresence>
    </div>
    </CloudSyncProvider>
  );
}
