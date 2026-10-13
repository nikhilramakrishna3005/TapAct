import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedDayKey } from "./score";

export type DuelListItem = {
  id: string;
  title: string;
  status: "pending" | "active" | "completed" | "cancelled";
  startsOn: string;
  durationDays: number;
  awaitingOpponent: boolean;
};

export type BoardDay = {
  dayKey: string;
  points: number;
  bonus: boolean;
  activities: { id: string; minutes: number; met: boolean }[];
};

export type DuelBoard = {
  duel: {
    id: string;
    title: string;
    durationDays: number;
    startsOn: string;
    status: string;
    final: boolean;
    winner: "you" | "friend" | "tie" | null;
    awaitingOpponent: boolean;
  };
  activities: { id: string; name: string; targetMinutes: number }[];
  you: {
    name: string;
    score: number;
    status: string;
    shareLive: boolean;
    muted: boolean;
    todayKey: string;
    mappings: { challengeActivityId: string; trackerActivityId: string }[];
  };
  friend: { name: string; score: number; status: string } | null;
  youDays: BoardDay[];
  friendDays: BoardDay[];
  presence: { name: string; activity: string; activityId: string } | null;
};

export type InvitePreview = {
  state: "open" | "used" | "expired" | "revoked" | "invalid";
  title?: string;
  durationDays?: number;
  startsOn?: string;
  inviter?: string;
  creator?: boolean;
  activities?: { name: string; targetMinutes: number }[];
  rules?: string[];
};

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function deviceTodayKey(): string {
  try {
    return zonedDayKey(Date.now(), deviceTimeZone());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function duelError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  const clean = message.replace(/^.*ERROR:\s*/i, "").split("\n")[0].trim();
  if (clean && clean.length < 180 && !/stack|syntax|permission denied|jwt/i.test(clean)) {
    return clean;
  }
  return "Couldn't reach duels. Check your connection and try again.";
}

async function call<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const duelsApi = {
  list: (client: SupabaseClient) => call<DuelListItem[]>(client, "tapact_list_duels", {}),
  board: (client: SupabaseClient, duelId: string) => call<DuelBoard>(client, "tapact_duel_board", { p_duel: duelId }),
  create: (client: SupabaseClient, payload: unknown) => call<{ duelId: string; token: string }>(client, "tapact_create_duel", { payload }),
  preview: (client: SupabaseClient, token: string) => call<InvitePreview>(client, "tapact_preview_duel_invite", { token }),
  accept: (client: SupabaseClient, token: string, zone: string) => call<{ duelId: string }>(client, "tapact_accept_duel_invite", { token, zone }),
  decline: (client: SupabaseClient, token: string) => call<void>(client, "tapact_decline_duel_invite", { token }),
  revoke: (client: SupabaseClient, duelId: string) => call<void>(client, "tapact_revoke_duel_invite", { p_duel: duelId }),
  reissue: (client: SupabaseClient, duelId: string) => call<{ token: string }>(client, "tapact_reissue_duel_invite", { p_duel: duelId }),
  leave: (client: SupabaseClient, duelId: string) => call<void>(client, "tapact_leave_duel", { p_duel: duelId }),
  prefs: (client: SupabaseClient, duelId: string, share: boolean, muted: boolean) =>
    call<void>(client, "tapact_set_duel_prefs", { p_duel: duelId, p_share: share, p_muted: muted }),
  map: (client: SupabaseClient, duelId: string, activityId: string, trackerActivityId: string | null) =>
    call<void>(client, "tapact_map_duel_activity", { p_duel: duelId, p_activity: activityId, p_tracker: trackerActivityId }),
  syncPresence: (client: SupabaseClient, trackerActivityId: string | null) =>
    call<void>(client, "tapact_sync_duel_presence", { p_tracker: trackerActivityId }),
};

export function inviteUrl(token: string): string {
  return `${window.location.origin}/duel/${token}`;
}

export async function shareInvite(token: string, title: string): Promise<"shared" | "copied"> {
  const url = inviteUrl(token);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text: "Join my TapAct duel", url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}
