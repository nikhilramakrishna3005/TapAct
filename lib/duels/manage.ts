import type { DuelListItem } from "./api";
import type { RuleActivityDraft, StoredRuleActivity } from "./rules";

export type DuelMenuAction = "cancel" | "leave" | "archive";

export type DuelConfirmCopy = {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
};

export function isArchivedDuel(item: Pick<DuelListItem, "archived" | "status">): boolean {
  return item.status === "cancelled" || (Boolean(item.archived) && item.status === "completed");
}

export function archivedDuelAction(item: Pick<DuelListItem, "archived" | "status">): "archive" | "restore" | null {
  if (item.archived) return "restore";
  if (item.status === "cancelled") return "archive";
  return null;
}

export function isMainListDuel(item: Pick<DuelListItem, "archived" | "status">): boolean {
  return !item.archived && (item.status === "pending" || item.status === "active" || item.status === "completed");
}

export function partitionDuelLists(items: DuelListItem[]): { main: DuelListItem[]; archived: DuelListItem[] } {
  return {
    main: items.filter(isMainListDuel),
    archived: items.filter(isArchivedDuel),
  };
}

export function duelMenuAction(item: Pick<DuelListItem, "status" | "creator" | "memberStatus" | "archived">): DuelMenuAction | null {
  if (item.status === "pending" && item.creator && item.memberStatus === "active") return "cancel";
  if (item.status === "active" && item.memberStatus === "active") return "leave";
  if ((item.status === "completed" || item.status === "cancelled") && !item.archived) return "archive";
  return null;
}

export function canRestoreDuel(item: Pick<DuelListItem, "archived">): boolean {
  return item.archived === true;
}

export function duelActionCopy(action: DuelMenuAction, title: string): DuelConfirmCopy {
  if (action === "cancel") {
    return {
      title: "Cancel duel",
      body: `"${title}" will be cancelled. Outstanding invite links will stop working. Your personal activities and tracking history stay on Today.`,
      confirmLabel: "Cancel duel",
      danger: true,
    };
  }
  if (action === "leave") {
    return {
      title: "Leave duel",
      body: `You will stop earning new points in "${title}". Points already recorded stay. Your friend can finish, and they will not see your live activity status. Their data is not removed.`,
      confirmLabel: "Leave duel",
      danger: true,
    };
  }
  return {
    title: "Remove from my list",
    body: `"${title}" will be hidden only for you. Official results stay, and your friend still has this duel.`,
    confirmLabel: "Remove from my list",
    danger: false,
  };
}

export function restoreCopy(title: string): DuelConfirmCopy {
  return {
    title: "Restore duel",
    body: `"${title}" will return to your personal list. Official results stay as they were.`,
    confirmLabel: "Restore",
    danger: false,
  };
}

export function removeActivityCopy(name: string, needsApproval: boolean): DuelConfirmCopy {
  const label = name.trim() || "this activity";
  if (needsApproval) {
    return {
      title: "Remove from duel",
      body: `"${label}" will be proposed for removal. Your friend has to approve. If they approve, later challenge days drop this activity. Earlier days keep their activities, targets, and points. Your Today activity and its history stay.`,
      confirmLabel: "Propose removal",
      danger: true,
    };
  }
  return {
    title: "Remove from duel",
    body: `"${label}" will be removed from this duel. The invite preview will update. Your Today activity and its history stay.`,
    confirmLabel: "Remove from duel",
    danger: true,
  };
}

export function canRemoveSharedActivity(count: number): { ok: true } | { ok: false; message: string } {
  if (count <= 1) {
    return { ok: false, message: "A duel needs at least one shared activity. Add another before removing this one." };
  }
  return { ok: true };
}

export function draftWithoutActivity(
  activities: StoredRuleActivity[],
  activityId: string,
): { ok: true; next: RuleActivityDraft[] } | { ok: false; message: string } {
  const allowed = canRemoveSharedActivity(activities.length);
  if (!allowed.ok) return allowed;
  const next = activities
    .filter((activity) => activity.id !== activityId)
    .map((activity) => ({ id: activity.id, name: activity.name, targetMinutes: activity.targetMinutes }));
  if (next.length === activities.length) {
    return { ok: false, message: "That activity is not part of this duel." };
  }
  return { ok: true, next };
}

export function replaceActivityDraft(
  activities: StoredRuleActivity[],
  activityId: string,
  patch: { name?: string; targetMinutes?: number },
): { ok: true; next: RuleActivityDraft[] } | { ok: false; message: string } {
  if (!activities.some((activity) => activity.id === activityId)) {
    return { ok: false, message: "That activity is not part of this duel." };
  }
  return {
    ok: true,
    next: activities.map((activity) => {
      if (activity.id !== activityId) return { id: activity.id, name: activity.name, targetMinutes: activity.targetMinutes };
      const name = patch.name?.trim() ?? activity.name;
      const targetMinutes = patch.targetMinutes ?? activity.targetMinutes;
      return { id: activity.id, name, targetMinutes };
    }),
  };
}

export function appendActivityDraft(
  activities: StoredRuleActivity[],
  added: { name: string; targetMinutes: number },
): { ok: true; next: RuleActivityDraft[] } | { ok: false; message: string } {
  if (activities.length >= 3) {
    return { ok: false, message: "A duel can include up to 3 activities." };
  }
  const name = added.name.trim();
  if (name.length < 2 || name.length > 36 || !Number.isInteger(added.targetMinutes) || added.targetMinutes < 5 || added.targetMinutes > 240) {
    return { ok: false, message: "Each activity needs a name and a target of 5–240 minutes." };
  }
  return {
    ok: true,
    next: [
      ...activities.map((activity) => ({ id: activity.id, name: activity.name, targetMinutes: activity.targetMinutes })),
      { name, targetMinutes: added.targetMinutes },
    ],
  };
}

export function alreadyResolvedDuelAction(message: string): boolean {
  return /already|not in this duel|only an open invite|already finished|already out of your list|already in your list/i.test(message);
}
