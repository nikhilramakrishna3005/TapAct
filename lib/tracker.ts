export type ActivityIconName =
  | "brain"
  | "dumbbell"
  | "message"
  | "book"
  | "briefcase"
  | "code"
  | "languages"
  | "heart"
  | "music"
  | "globe"
  | "pen"
  | "palette";

export type Activity = {
  id: string;
  name: string;
  iconKey: ActivityIconName;
  color: string;
  goalMinutes: number | null;
  cue: string;
  archivedAtMs: number | null;
};

export type DailyRecords = Record<string, Record<string, number>>;

export type TrackerState = {
  schemaVersion: 3;
  activeActivityId: string | null;
  activeSinceMs: number | null;
  lastProcessedMs: number | null;
  activities: Activity[];
  dailyRecords: DailyRecords;
};

type LegacyTrackerState = {
  dayKey?: unknown;
  activeActivityId?: unknown;
  activeSinceMs?: unknown;
  elapsedMs?: unknown;
  activities?: unknown;
};

type V3Candidate = {
  schemaVersion?: unknown;
  activeActivityId?: unknown;
  activeSinceMs?: unknown;
  lastProcessedMs?: unknown;
  activities?: unknown;
  dailyRecords?: unknown;
};

export type StorageLike = {
  getItem: (key: string) => string | null;
};

export const STORAGE_KEY_V3 = "tapact.tracker.v3";
export const STORAGE_KEY_V2 = "tapact.tracker.v2";
export const LEGACY_STORAGE_KEY = "tapact.tracker.v1";
export const MS_PER_MINUTE = 60_000;

const DEFAULT_COLOR = "#B6BFCB";

export const DEFAULT_ACTIVITIES: Activity[] = [
  {
    id: "coding",
    name: "Coding",
    iconKey: "brain",
    color: "#8B95FF",
    goalMinutes: 140,
    cue: "Deep work sessions",
    archivedAtMs: null,
  },
  {
    id: "gym",
    name: "Gym",
    iconKey: "dumbbell",
    color: "#4FD1A5",
    goalMinutes: 50,
    cue: "Strength and cardio",
    archivedAtMs: null,
  },
  {
    id: "communication",
    name: "Communication",
    iconKey: "message",
    color: "#E0A6FF",
    goalMinutes: 45,
    cue: "Speaking practice",
    archivedAtMs: null,
  },
  {
    id: "reading",
    name: "Reading",
    iconKey: "book",
    color: "#7EC8F8",
    goalMinutes: 60,
    cue: "Focused reading time",
    archivedAtMs: null,
  },
];

const ICON_NAME_SET = new Set<ActivityIconName>([
  "brain",
  "dumbbell",
  "message",
  "book",
  "briefcase",
  "code",
  "languages",
  "heart",
  "music",
  "globe",
  "pen",
  "palette",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isColorHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function sanitizeMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function sanitizeGoalMinutes(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1440
  ) {
    return Math.round(value);
  }
  return null;
}

export function getDayKeyForDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDayKeyForMs(ms: number): string {
  return getDayKeyForDate(new Date(ms));
}

function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeActivity(activity: unknown, fallbackIndex: number): Activity | null {
  if (!isRecord(activity)) {
    return null;
  }

  const id =
    typeof activity.id === "string" && activity.id.trim().length > 0
      ? activity.id.trim()
      : `activity-${fallbackIndex + 1}`;

  const name =
    typeof activity.name === "string" && activity.name.trim().length > 0
      ? activity.name.trim().slice(0, 36)
      : null;

  if (!name) {
    return null;
  }

  const iconKey =
    typeof activity.iconKey === "string" && ICON_NAME_SET.has(activity.iconKey as ActivityIconName)
      ? (activity.iconKey as ActivityIconName)
      : "briefcase";

  const color =
    typeof activity.color === "string" && isColorHex(activity.color) ? activity.color : DEFAULT_COLOR;

  const cue =
    typeof activity.cue === "string" && activity.cue.trim().length > 0
      ? activity.cue.trim().slice(0, 48)
      : "Custom activity";

  const archivedAtMs = sanitizeMs(activity.archivedAtMs);

  return {
    id,
    name,
    iconKey,
    color,
    goalMinutes: sanitizeGoalMinutes(activity.goalMinutes),
    cue,
    archivedAtMs,
  };
}

function dedupeActivities(activities: Activity[]): Activity[] {
  const uniqueIds = new Set<string>();
  const next: Activity[] = [];
  for (const activity of activities) {
    if (uniqueIds.has(activity.id)) {
      continue;
    }
    uniqueIds.add(activity.id);
    next.push(activity);
  }
  return next.length > 0 ? next : DEFAULT_ACTIVITIES;
}

function cloneDailyRecords(records: DailyRecords): DailyRecords {
  const next: DailyRecords = {};
  for (const [dayKey, dayRecord] of Object.entries(records)) {
    next[dayKey] = { ...dayRecord };
  }
  return next;
}

function normalizeDailyRecords(
  value: unknown,
  validActivityIds: Set<string>,
): DailyRecords {
  if (!isRecord(value)) {
    return {};
  }

  const next: DailyRecords = {};
  for (const [dayKey, dayRecord] of Object.entries(value)) {
    if (!isDayKey(dayKey) || !isRecord(dayRecord)) {
      continue;
    }

    const normalizedDay: Record<string, number> = {};
    for (const [activityId, rawMs] of Object.entries(dayRecord)) {
      if (!validActivityIds.has(activityId)) {
        continue;
      }
      const ms = sanitizeMs(rawMs);
      if (ms === null) {
        continue;
      }
      normalizedDay[activityId] = ms;
    }

    if (Object.keys(normalizedDay).length > 0) {
      next[dayKey] = normalizedDay;
    }
  }
  return next;
}

export function createDefaultTrackerState(nowMs: number): TrackerState {
  void nowMs;
  return {
    schemaVersion: 3,
    activeActivityId: null,
    activeSinceMs: null,
    lastProcessedMs: null,
    activities: DEFAULT_ACTIVITIES,
    dailyRecords: {},
  };
}

function normalizeStateCore(
  candidateActivities: unknown,
  fallbackActivities: Activity[],
): Activity[] {
  if (!Array.isArray(candidateActivities)) {
    return fallbackActivities;
  }
  const parsed = candidateActivities
    .map((activity, index) => normalizeActivity(activity, index))
    .filter((activity): activity is Activity => activity !== null);
  return dedupeActivities(parsed.length > 0 ? parsed : fallbackActivities);
}

function normalizeActiveTimer(
  state: TrackerState,
  nowMs: number,
): Pick<TrackerState, "activeActivityId" | "activeSinceMs" | "lastProcessedMs"> {
  const validIds = new Set(
    state.activities.filter((activity) => activity.archivedAtMs === null).map((activity) => activity.id),
  );

  if (typeof state.activeActivityId !== "string" || !validIds.has(state.activeActivityId)) {
    return {
      activeActivityId: null,
      activeSinceMs: null,
      lastProcessedMs: null,
    };
  }

  const activeSinceMs = sanitizeMs(state.activeSinceMs);
  if (activeSinceMs === null) {
    return {
      activeActivityId: null,
      activeSinceMs: null,
      lastProcessedMs: null,
    };
  }

  const safeActiveSince = Math.min(activeSinceMs, nowMs);
  const parsedLastProcessed = sanitizeMs(state.lastProcessedMs);
  const lastProcessedMs = Math.max(
    safeActiveSince,
    Math.min(parsedLastProcessed ?? safeActiveSince, nowMs),
  );

  return {
    activeActivityId: state.activeActivityId,
    activeSinceMs: safeActiveSince,
    lastProcessedMs,
  };
}

function normalizeV3State(value: unknown, nowMs: number): TrackerState | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value as V3Candidate;
  if (candidate.schemaVersion !== 3) {
    return null;
  }

  const activities = normalizeStateCore(candidate.activities, DEFAULT_ACTIVITIES);
  const validActivityIds = new Set(activities.map((activity) => activity.id));
  const state: TrackerState = {
    schemaVersion: 3,
    activeActivityId:
      typeof candidate.activeActivityId === "string" ? candidate.activeActivityId : null,
    activeSinceMs:
      typeof candidate.activeSinceMs === "number" ? candidate.activeSinceMs : null,
    lastProcessedMs:
      typeof candidate.lastProcessedMs === "number" ? candidate.lastProcessedMs : null,
    activities,
    dailyRecords: normalizeDailyRecords(candidate.dailyRecords, validActivityIds),
  };

  const normalizedActive = normalizeActiveTimer(state, nowMs);
  const normalized: TrackerState = {
    ...state,
    ...normalizedActive,
  };
  return processActiveTimer(normalized, nowMs);
}

function normalizeLegacyState(value: unknown, nowMs: number): TrackerState | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value as LegacyTrackerState;
  const activities = normalizeStateCore(candidate.activities, DEFAULT_ACTIVITIES);
  const validActivityIds = new Set(activities.map((activity) => activity.id));
  const dayKey = isDayKey(candidate.dayKey) ? candidate.dayKey : null;

  const dailyRecords: DailyRecords = {};
  if (dayKey && isRecord(candidate.elapsedMs)) {
    const dayRecord: Record<string, number> = {};
    for (const activityId of validActivityIds) {
      const ms = sanitizeMs(candidate.elapsedMs[activityId]);
      if (ms !== null) {
        dayRecord[activityId] = ms;
      }
    }
    if (Object.keys(dayRecord).length > 0) {
      dailyRecords[dayKey] = dayRecord;
    }
  }

  const activeActivityId =
    typeof candidate.activeActivityId === "string" && validActivityIds.has(candidate.activeActivityId)
      ? candidate.activeActivityId
      : null;
  const activeSinceMs = sanitizeMs(candidate.activeSinceMs);

  const migrated: TrackerState = {
    schemaVersion: 3,
    activities,
    dailyRecords,
    activeActivityId,
    activeSinceMs: activeActivityId && activeSinceMs !== null ? Math.min(activeSinceMs, nowMs) : null,
    lastProcessedMs:
      activeActivityId && activeSinceMs !== null ? Math.min(activeSinceMs, nowMs) : null,
  };

  return processActiveTimer(migrated, nowMs);
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadTrackerState(storage: StorageLike, nowMs: number): TrackerState {
  const v3Raw = storage.getItem(STORAGE_KEY_V3);
  if (v3Raw) {
    const parsed = safeJsonParse(v3Raw);
    const normalized = normalizeV3State(parsed, nowMs);
    if (normalized) {
      return normalized;
    }
  }

  const legacyKeys = [STORAGE_KEY_V2, LEGACY_STORAGE_KEY];
  for (const key of legacyKeys) {
    const raw = storage.getItem(key);
    if (!raw) {
      continue;
    }
    const parsed = safeJsonParse(raw);
    const migrated = normalizeLegacyState(parsed, nowMs);
    if (migrated) {
      return migrated;
    }
  }

  return createDefaultTrackerState(nowMs);
}

export function serializeTrackerState(state: TrackerState): string {
  return JSON.stringify(state);
}

type DaySpan = {
  dayKey: string;
  durationMs: number;
};

function splitAcrossDays(startMs: number, endMs: number): DaySpan[] {
  if (!(endMs > startMs)) {
    return [];
  }

  const spans: DaySpan[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const dateAtCursor = new Date(cursor);
    const dayKey = getDayKeyForDate(dateAtCursor);
    const nextMidnight = new Date(dateAtCursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const boundary = Math.min(endMs, Math.max(cursor + 1, nextMidnight.getTime()));

    spans.push({ dayKey, durationMs: boundary - cursor });
    cursor = boundary;
  }
  return spans;
}

function addElapsedToDailyRecords(
  dailyRecords: DailyRecords,
  activityId: string,
  startMs: number,
  endMs: number,
): DailyRecords {
  const spans = splitAcrossDays(startMs, endMs);
  if (spans.length === 0) {
    return dailyRecords;
  }

  const next = cloneDailyRecords(dailyRecords);
  for (const span of spans) {
    const dayRecord = next[span.dayKey] ? { ...next[span.dayKey] } : {};
    dayRecord[activityId] = Math.max(0, (dayRecord[activityId] ?? 0) + span.durationMs);
    next[span.dayKey] = dayRecord;
  }
  return next;
}

export function processActiveTimer(state: TrackerState, nowMs: number): TrackerState {
  if (!state.activeActivityId || state.activeSinceMs === null) {
    if (state.lastProcessedMs === null) {
      return state;
    }
    return {
      ...state,
      lastProcessedMs: null,
    };
  }

  const startMs = Math.max(state.activeSinceMs, state.lastProcessedMs ?? state.activeSinceMs);
  const endMs = Math.max(startMs, nowMs);
  if (endMs === startMs) {
    if (state.lastProcessedMs === endMs) {
      return state;
    }
    return {
      ...state,
      lastProcessedMs: endMs,
    };
  }

  return {
    ...state,
    dailyRecords: addElapsedToDailyRecords(
      state.dailyRecords,
      state.activeActivityId,
      startMs,
      endMs,
    ),
    lastProcessedMs: endMs,
  };
}

export function toggleActivity(
  state: TrackerState,
  activityId: string,
  nowMs: number,
): TrackerState {
  const settled = processActiveTimer(state, nowMs);
  const activity = settled.activities.find((item) => item.id === activityId);
  if (!activity || activity.archivedAtMs !== null) {
    return settled;
  }

  if (settled.activeActivityId === activityId) {
    return {
      ...settled,
      activeActivityId: null,
      activeSinceMs: null,
      lastProcessedMs: null,
    };
  }

  return {
    ...settled,
    activeActivityId: activityId,
    activeSinceMs: nowMs,
    lastProcessedMs: nowMs,
  };
}

export function addActivity(
  state: TrackerState,
  activity: Omit<Activity, "archivedAtMs">,
): TrackerState {
  return {
    ...state,
    activities: [...state.activities, { ...activity, archivedAtMs: null }],
  };
}

export function updateActivity(
  state: TrackerState,
  activityId: string,
  updates: Partial<Pick<Activity, "name" | "iconKey" | "color" | "goalMinutes" | "cue">>,
): TrackerState {
  const name = updates.name?.trim();
  const cue = updates.cue?.trim();

  return {
    ...state,
    activities: state.activities.map((activity) => {
      if (activity.id !== activityId) {
        return activity;
      }
      return {
        ...activity,
        name:
          typeof name === "string" && name.length > 0
            ? name.slice(0, 36)
            : activity.name,
        iconKey:
          updates.iconKey && ICON_NAME_SET.has(updates.iconKey)
            ? updates.iconKey
            : activity.iconKey,
        color:
          typeof updates.color === "string" && isColorHex(updates.color)
            ? updates.color
            : activity.color,
        goalMinutes:
          updates.goalMinutes === null
            ? null
            : sanitizeGoalMinutes(updates.goalMinutes) ?? activity.goalMinutes,
        cue:
          typeof cue === "string" && cue.length > 0
            ? cue.slice(0, 48)
            : activity.cue,
      };
    }),
  };
}

export function archiveActivity(
  state: TrackerState,
  activityId: string,
  nowMs: number,
): TrackerState {
  const settled = processActiveTimer(state, nowMs);
  const wasActive = settled.activeActivityId === activityId;

  return {
    ...settled,
    activities: settled.activities.map((activity) =>
      activity.id === activityId && activity.archivedAtMs === null
        ? { ...activity, archivedAtMs: nowMs }
        : activity,
    ),
    activeActivityId: wasActive ? null : settled.activeActivityId,
    activeSinceMs: wasActive ? null : settled.activeSinceMs,
    lastProcessedMs: wasActive ? null : settled.lastProcessedMs,
  };
}

export function getElapsedByActivityForDay(
  state: TrackerState,
  dayKey: string,
): Record<string, number> {
  const source = state.dailyRecords[dayKey] ?? {};
  const elapsed: Record<string, number> = {};
  for (const activity of state.activities) {
    elapsed[activity.id] = Math.max(0, source[activity.id] ?? 0);
  }
  return elapsed;
}

export function getDayTotalElapsed(state: TrackerState, dayKey: string): number {
  const source = state.dailyRecords[dayKey] ?? {};
  return Object.values(source).reduce((sum, value) => sum + Math.max(0, value), 0);
}

export function createActivityId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug || "activity"}-${suffix}`;
}
