import {
  addActivity,
  archiveActivity,
  processActiveTimer,
  type Activity,
  type TrackerState,
} from "./tracker";

export type StarterActivity = Omit<Activity, "archivedAtMs">;

/** The first four reuse the default activity ids so choosing them keeps any existing time attached. */
export const STARTER_PRESETS: StarterActivity[] = [
  { id: "coding", name: "Coding", iconKey: "code", color: "#8E7BFF", goalMinutes: 120, cue: "Deep work sessions" },
  { id: "gym", name: "Workout", iconKey: "dumbbell", color: "#6CF2C2", goalMinutes: 45, cue: "Strength and cardio" },
  { id: "reading", name: "Reading", iconKey: "book", color: "#5FE3FF", goalMinutes: 30, cue: "Focused reading time" },
  { id: "communication", name: "Communication", iconKey: "message", color: "#FF7AB6", goalMinutes: 30, cue: "Speaking practice" },
  { id: "deep-work", name: "Deep Work", iconKey: "brain", color: "#B9ADFF", goalMinutes: 90, cue: "No-distraction focus" },
  { id: "meditation", name: "Meditation", iconKey: "heart", color: "#A7F06B", goalMinutes: 15, cue: "Breath and stillness" },
  { id: "language", name: "Language", iconKey: "languages", color: "#FFB86B", goalMinutes: 20, cue: "Daily practice" },
  { id: "writing", name: "Writing", iconKey: "pen", color: "#FFE36B", goalMinutes: 30, cue: "Words on the page" },
  { id: "music", name: "Music", iconKey: "music", color: "#FF8F6B", goalMinutes: 30, cue: "Instrument practice" },
  { id: "creative", name: "Creative", iconKey: "palette", color: "#C2C6D6", goalMinutes: null, cue: "Make something" },
];

export const DEFAULT_STARTER_IDS = ["coding", "gym", "reading", "communication"];

/**
 * Replaces the active activity set with the chosen starters. Unchosen activities
 * that already have recorded time are archived (history is never lost); unchosen
 * activities without any history are dropped.
 */
export function applyStarterActivities(
  state: TrackerState,
  starters: StarterActivity[],
  nowMs: number,
): TrackerState {
  if (starters.length === 0) {
    return state;
  }
  const chosenIds = new Set(starters.map((starter) => starter.id));
  let next = processActiveTimer(state, nowMs);
  const recordedIds = new Set(Object.values(next.dailyRecords).flatMap((day) => Object.keys(day)));
  for (const activity of next.activities) {
    if (!chosenIds.has(activity.id) && activity.archivedAtMs === null) {
      next = archiveActivity(next, activity.id, nowMs);
    }
  }

  const kept = next.activities.filter(
    (activity) => !chosenIds.has(activity.id) && recordedIds.has(activity.id),
  );
  next = { ...next, activities: [] };
  for (const starter of starters) {
    next = addActivity(next, starter);
  }
  return { ...next, activities: [...next.activities, ...kept] };
}
