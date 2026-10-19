/** Matching a Duel activity to an existing Today activity. Presentation only; scoring is unchanged. */

export const CREATE_ACTIVITY_ON_TODAY_MESSAGE =
  "Create an activity on Today first, then come back to link it here.";

export type ConnectableActivity = {
  id: string;
  name: string;
  archivedAtMs: number | null;
  goalMinutes?: number | null;
};

export type DashboardDuelDraft = {
  name: string;
  targetMinutes: number;
  trackerActivityId: string;
};

export type DuelLinkDecision =
  | { action: "connected"; trackerActivityId: string }
  | { action: "link"; trackerActivityId: string }
  | { action: "choose"; matches: ConnectableActivity[] }
  | { action: "needs-activity" };

export function normalizeActivityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Active activities whose names match after trimming, case folding, and collapsing whitespace. */
export function activeNameMatches<T extends ConnectableActivity>(activities: readonly T[], duelName: string): T[] {
  const key = normalizeActivityName(duelName);
  if (!key) return [];
  return activities.filter(
    (activity) => activity.archivedAtMs === null && normalizeActivityName(activity.name) === key,
  );
}

/**
 * Decides how a Duel activity should connect to Today.
 * A selected id is an intentional choice and is never replaced by a name guess.
 * When Today has nothing to link, the result is needs-activity: do not create one.
 */
export function decideDuelActivityLink(input: {
  duelName: string;
  mappedTrackerId: string | null;
  activities: readonly ConnectableActivity[];
  selectedTrackerId?: string | null;
}): DuelLinkDecision {
  const active = activeDashboardActivities(input.activities);
  const mapped = input.mappedTrackerId
    ? active.find((activity) => activity.id === input.mappedTrackerId) ?? null
    : null;

  if (input.selectedTrackerId) {
    if (mapped?.id === input.selectedTrackerId) {
      return { action: "connected", trackerActivityId: mapped.id };
    }
    const selected = active.find((activity) => activity.id === input.selectedTrackerId);
    if (selected) return { action: "link", trackerActivityId: selected.id };
    return mapped ? { action: "connected", trackerActivityId: mapped.id } : { action: "needs-activity" };
  }

  if (mapped) return { action: "connected", trackerActivityId: mapped.id };

  const matches = activeNameMatches(active, input.duelName);
  if (matches.length === 1) return { action: "link", trackerActivityId: matches[0].id };
  if (matches.length > 1) return { action: "choose", matches };
  return { action: "needs-activity" };
}

/** Active Today activities. Archived activities stay off the duel selector. */
export function activeDashboardActivities<T extends ConnectableActivity>(activities: readonly T[]): T[] {
  return activities.filter((activity) => activity.archivedAtMs === null);
}

/** Duel draft for an existing Today activity. The link is the stable activity id. */
export function draftFromDashboardActivity(activity: ConnectableActivity): DashboardDuelDraft | null {
  if (activity.archivedAtMs !== null) return null;
  const goal = activity.goalMinutes;
  const targetMinutes = typeof goal === "number" && Number.isFinite(goal) ? goal : 20;
  return { name: activity.name, targetMinutes, trackerActivityId: activity.id };
}

/**
 * Selects or clears one Today activity in a duel draft.
 * The same id cannot be added twice, and nothing is created.
 */
function draftsWithIds(
  selected: readonly { name: string; targetMinutes: number; trackerActivityId: string | null }[],
): DashboardDuelDraft[] {
  return selected.flatMap((item) =>
    item.trackerActivityId
      ? [{ name: item.name, targetMinutes: item.targetMinutes, trackerActivityId: item.trackerActivityId }]
      : [],
  );
}

export function toggleDuelDashboardSelection(
  selected: readonly { name: string; targetMinutes: number; trackerActivityId: string | null }[],
  activity: ConnectableActivity,
  limit = 3,
): { ok: true; activities: DashboardDuelDraft[] } | { ok: false; message: string } {
  const current = draftsWithIds(selected);
  if (current.some((item) => item.trackerActivityId === activity.id)) {
    return { ok: true, activities: current.filter((item) => item.trackerActivityId !== activity.id) };
  }
  if (activity.archivedAtMs !== null) {
    return { ok: false, message: "Choose an activity from Today." };
  }
  if (current.length >= limit) {
    return { ok: false, message: "A duel can include up to 3 activities." };
  }
  const draft = draftFromDashboardActivity(activity);
  if (!draft) return { ok: false, message: "Choose an activity from Today." };
  return { ok: true, activities: [...current, draft] };
}

export type JoinLinkPlan<T extends ConnectableActivity> =
  | { kind: "empty"; message: string }
  | { kind: "choose"; activities: T[] };

/** Activities the joining user can link. An empty dashboard does not create one. */
export function planJoinLink<T extends ConnectableActivity>(activities: readonly T[]): JoinLinkPlan<T> {
  const active = activeDashboardActivities(activities);
  if (active.length === 0) {
    return { kind: "empty", message: CREATE_ACTIVITY_ON_TODAY_MESSAGE };
  }
  return { kind: "choose", activities: active };
}

/** True when another challenge in this duel already uses this Today activity. */
export function trackerUsedByOtherChallenge(
  mappings: readonly { challengeActivityId: string; trackerActivityId: string }[],
  challengeActivityId: string,
  trackerActivityId: string,
): boolean {
  return mappings.some(
    (item) => item.trackerActivityId === trackerActivityId && item.challengeActivityId !== challengeActivityId,
  );
}

/** Linking keeps the existing activity list. It never appends a dashboard activity. */
export function linkWithoutDuplicating<T extends { id: string }>(
  activities: readonly T[],
  trackerActivityId: string,
): { activities: readonly T[]; linkedId: string | null } {
  const match = activities.find((activity) => activity.id === trackerActivityId);
  return { activities, linkedId: match ? match.id : null };
}

export function trackerCommitPersisted(result: { persisted?: boolean } | void | null | undefined): boolean {
  return result?.persisted === true;
}

/** First call claims the attempt. A second call while it is held does nothing. */
export function claimLinkAttempt(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}
