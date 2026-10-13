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
