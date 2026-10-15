/** Matching a Duel activity to an existing Today activity. Presentation only; scoring is unchanged. */

export type ConnectableActivity = {
  id: string;
  name: string;
  archivedAtMs: number | null;
  goalMinutes?: number | null;
};

export type DuelLinkDecision =
  | { action: "connected"; trackerActivityId: string }
  | { action: "link"; trackerActivityId: string }
  | { action: "choose"; matches: ConnectableActivity[] }
  | { action: "create" };

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
 * Decides how "Add to my activities" should connect a Duel activity.
 * A selected id is an intentional choice and is never replaced by a name guess.
 */
export function decideDuelActivityLink(input: {
  duelName: string;
  mappedTrackerId: string | null;
  activities: readonly ConnectableActivity[];
  selectedTrackerId?: string | null;
}): DuelLinkDecision {
  const active = input.activities.filter((activity) => activity.archivedAtMs === null);
  const mapped = input.mappedTrackerId
    ? active.find((activity) => activity.id === input.mappedTrackerId) ?? null
    : null;

  if (input.selectedTrackerId) {
    if (mapped?.id === input.selectedTrackerId) {
      return { action: "connected", trackerActivityId: mapped.id };
    }
    const selected = active.find((activity) => activity.id === input.selectedTrackerId);
    if (selected) return { action: "link", trackerActivityId: selected.id };
    return mapped ? { action: "connected", trackerActivityId: mapped.id } : { action: "create" };
  }

  if (mapped) return { action: "connected", trackerActivityId: mapped.id };

  const matches = activeNameMatches(active, input.duelName);
  if (matches.length === 1) return { action: "link", trackerActivityId: matches[0].id };
  if (matches.length > 1) return { action: "choose", matches };
  return { action: "create" };
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
