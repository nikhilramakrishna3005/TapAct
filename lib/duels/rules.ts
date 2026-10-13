export type RuleChange =
  | { kind: "add"; name: string; targetMinutes: number }
  | { kind: "remove"; name: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "target"; name: string; from: number; to: number };

/** Exact differences between the rules in force and a proposal. Order follows the proposal. */
export function describeRuleChanges(current: StoredRuleActivity[], next: RuleActivityDraft[]): RuleChange[] {
  const changes: RuleChange[] = [];
  const currentById = new Map(current.map((activity) => [activity.id, activity]));
  const seen = new Set<string>();
  for (const activity of next) {
    const name = activity.name.trim();
    if (!activity.id || !currentById.has(activity.id)) {
      changes.push({ kind: "add", name, targetMinutes: activity.targetMinutes });
      continue;
    }
    seen.add(activity.id);
    const previous = currentById.get(activity.id)!;
    if (previous.name !== name) changes.push({ kind: "rename", from: previous.name, to: name });
    if (previous.targetMinutes !== activity.targetMinutes) {
      changes.push({ kind: "target", name, from: previous.targetMinutes, to: activity.targetMinutes });
    }
  }
  for (const activity of current) {
    if (!seen.has(activity.id)) changes.push({ kind: "remove", name: activity.name });
  }
  return changes;
}

export function reviewRuleProposal(input: {
  viewerId: string | null;
  proposerId: string;
  memberIds: string[];
  duelStatus: "pending" | "active" | "completed" | "cancelled";
  proposalStatus: "pending" | "approved" | "rejected" | "withdrawn" | "stale";
  baseVersion: number;
  currentVersion: number;
  action: "approve" | "reject" | "withdraw";
}): { ok: true } | { ok: false; message: string } {
  if (!input.viewerId) return { ok: false, message: "Sign in to manage this duel." };
  if (!input.memberIds.includes(input.viewerId)) return { ok: false, message: "You are not in this duel." };
  if (input.duelStatus !== "active") return { ok: false, message: "Rules can only change during an active duel." };
  if (input.proposalStatus !== "pending") return { ok: false, message: "This change was already resolved." };
  if (input.action === "withdraw") {
    if (input.viewerId !== input.proposerId) return { ok: false, message: "Only the person who proposed this change can withdraw it." };
    return { ok: true };
  }
  if (input.viewerId === input.proposerId) return { ok: false, message: "The other player has to approve this change." };
  if (input.baseVersion !== input.currentVersion) return { ok: false, message: "The rules changed. Review them and propose again." };
  return { ok: true };
}

/**
 * Mirrors tapact_set_duel_rules. The database function is the gate.
 * Existing ids are kept, so a rename or reorder does not replace the row.
 */

export type StoredRuleActivity = { id: string; name: string; targetMinutes: number };
export type RuleActivityDraft = { id?: string; name: string; targetMinutes: number };

export type RuleEditInput = {
  viewerId: string | null;
  creatorId: string;
  status: "pending" | "active" | "completed" | "cancelled";
  existing: StoredRuleActivity[];
  next: RuleActivityDraft[];
  newId: () => string;
};

const LOCKED = "Shared activities can only be changed before your friend accepts.";

export function applyPendingRuleEdit(
  input: RuleEditInput,
): { ok: true; activities: StoredRuleActivity[] } | { ok: false; message: string } {
  if (!input.viewerId) return { ok: false, message: "Sign in to manage this duel." };
  if (input.viewerId !== input.creatorId || input.status !== "pending") {
    return { ok: false, message: LOCKED };
  }
  if (input.next.length < 1 || input.next.length > 3) {
    return { ok: false, message: "Choose 1 to 3 activities." };
  }

  const seen = new Set<string>();
  for (const activity of input.next) {
    const name = activity.name.trim();
    if (name.length < 2 || name.length > 36 || !Number.isInteger(activity.targetMinutes) || activity.targetMinutes < 5 || activity.targetMinutes > 240) {
      return { ok: false, message: "Each activity needs a name and a target of 5–240 minutes." };
    }
    if (!activity.id) continue;
    if (seen.has(activity.id)) return { ok: false, message: "Each activity can only appear once." };
    if (!input.existing.some((item) => item.id === activity.id)) {
      return { ok: false, message: "That activity is not part of this duel." };
    }
    seen.add(activity.id);
  }

  return {
    ok: true,
    activities: input.next.map((activity) => ({
      id: activity.id ?? input.newId(),
      name: activity.name.trim(),
      targetMinutes: activity.targetMinutes,
    })),
  };
}
