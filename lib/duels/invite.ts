import { DUEL_DURATIONS, isDuelDuration, type DuelDuration } from "./score";

export const MIN_TARGET_MINUTES = 5;
export const MAX_TARGET_MINUTES = 240;
export const MAX_ACTIVITIES = 3;
const TITLE_MAX = 48;
const NAME_MAX = 36;

export type DuelActivityDraft = { name: string; targetMinutes: number; trackerActivityId: string | null };

export type DuelDraft = {
  title: string;
  durationDays: DuelDuration;
  startsOn: string;
  timeZone: string;
  activities: DuelActivityDraft[];
};

export type InviteFacts = {
  viewerId: string | null;
  creatorId: string;
  expiresAtMs: number;
  revoked: boolean;
  accepted: boolean;
  memberCount: number;
  startsOn: string;
  durationDays: number;
  nowMs: number;
  viewerZone: string;
};

export type InviteBlock = "sign-in" | "self" | "expired" | "revoked" | "used" | "full" | "ended";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[A-Za-z0-9_+\/-]{1,64}$/;

export function suggestDuelTitle(durationDays: number, activityName: string): string {
  const name = activityName.trim();
  const base = name ? `${durationDays}-day ${name}` : `${durationDays}-day duel`;
  return base.slice(0, TITLE_MAX);
}

export function validateDuelDraft(draft: DuelDraft, todayKey: string): { ok: true } | { ok: false; message: string } {
  if (!isDuelDuration(draft.durationDays)) {
    return { ok: false, message: "Choose a 7, 14, or 30 day duel." };
  }
  if (!DAY_KEY.test(draft.startsOn) || draft.startsOn < todayKey || draft.startsOn > addDays(todayKey, 14)) {
    return { ok: false, message: "The start date has to be today or within two weeks." };
  }
  if (!ZONE.test(draft.timeZone)) {
    return { ok: false, message: "This device's time zone can't be used for a duel." };
  }
  const title = draft.title.trim();
  if (title.length < 2 || title.length > TITLE_MAX) {
    return { ok: false, message: "Give the duel a title (2–48 characters)." };
  }
  if (draft.activities.length < 1 || draft.activities.length > MAX_ACTIVITIES) {
    return { ok: false, message: "Choose 1 to 3 activities." };
  }
  for (const activity of draft.activities) {
    const name = activity.name.trim();
    if (name.length < 2 || name.length > NAME_MAX) {
      return { ok: false, message: "Each activity needs a name (2–36 characters)." };
    }
    if (!Number.isInteger(activity.targetMinutes) || activity.targetMinutes < MIN_TARGET_MINUTES || activity.targetMinutes > MAX_TARGET_MINUTES) {
      return { ok: false, message: `Daily targets must be ${MIN_TARGET_MINUTES}–${MAX_TARGET_MINUTES} minutes.` };
    }
  }
  return { ok: true };
}

/**
 * Mirrors tapact_accept_duel_invite. The database function is the real gate;
 * this is the same decision table, tested here.
 */
export function inviteDecision(facts: InviteFacts): InviteBlock | "ok" {
  if (!facts.viewerId) return "sign-in";
  if (facts.viewerId === facts.creatorId) return "self";
  if (facts.revoked) return "revoked";
  if (facts.accepted) return "used";
  if (facts.nowMs >= facts.expiresAtMs) return "expired";
  if (facts.memberCount >= 2) return "full";
  const end = addDays(facts.startsOn, facts.durationDays);
  if (zonedToday(facts.nowMs, facts.viewerZone) >= end) return "ended";
  return "ok";
}

function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedToday(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function inviteBlockMessage(block: InviteBlock): string {
  switch (block) {
    case "sign-in":
      return "Sign in to respond to this invite.";
    case "self":
      return "You can't accept your own invite.";
    case "expired":
      return "This invite has expired.";
    case "revoked":
      return "This invite was revoked.";
    case "used":
      return "This invite has already been used.";
    case "full":
      return "This duel already has two people.";
    case "ended":
      return "This duel has already ended.";
  }
}

export const DURATION_OPTIONS = DUEL_DURATIONS;
