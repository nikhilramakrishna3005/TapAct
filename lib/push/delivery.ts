import { NOTIFICATION_EVENTS, type NotificationEventType } from "../duels/notifications";

export const MAX_PUSH_ATTEMPTS = 5;
/**
 * Each claimed row needs a prepare call, a push send, and a finish call.
 * Four sequential rows stay inside the 10-second Hobby function limit.
 * The daily cron is a sweep, not a promise of timely delivery.
 */
export const PUSH_BATCH_LIMIT = 4;
export const STALE_CLAIM_MS = 10 * 60 * 1000;

export const PUSH_EVENT_LABELS: Record<NotificationEventType, string> = {
  invite_accepted: "Invite accepted",
  duel_started: "Duel started",
  proposal_received: "Rule change proposed",
  proposal_approved: "Rule change approved",
  proposal_rejected: "Rule change rejected",
  rules_effective: "Approved rules now effective",
  duel_finished: "Duel finished",
  opponent_left: "Opponent left",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
]);

export type PushOutcome = "sent" | "retry" | "invalid" | "dead";

export type PushPreferenceState = {
  pushEnabled: boolean;
  events: Record<NotificationEventType, boolean>;
};

export type ClaimedPushDelivery = {
  id: string;
  claimToken: string;
  notificationId: string;
  title: string;
  body: string;
  duelId: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
};

export type PushDispatchSummary = {
  sent: number;
  retried: number;
  dropped: number;
  failed: number;
  skipped: number;
};

/** A worker may send or finish only the lease it claimed, for the notification's recipient. */
export function deliveryLeaseMatches(input: {
  status: string;
  claimToken: string | null;
  presentedToken: string;
  recipientId: string;
  subscriptionUserId: string;
  subscriptionDisabled: boolean;
}): boolean {
  return input.status === "sending"
    && input.claimToken !== null
    && input.claimToken === input.presentedToken
    && input.recipientId === input.subscriptionUserId
    && !input.subscriptionDisabled;
}

export type DeliveryRow = {
  id: string;
  status: "pending" | "sending" | "sent" | "failed" | "dead" | "cancelled";
  attempts: number;
  nextAttemptAt: number;
  claimedAt: number | null;
};

export function defaultPushEvents(): Record<NotificationEventType, boolean> {
  return Object.fromEntries(NOTIFICATION_EVENTS.map((event) => [event, true])) as Record<NotificationEventType, boolean>;
}

export function shouldEnqueuePush(prefs: PushPreferenceState | null, event: NotificationEventType): boolean {
  if (!prefs?.pushEnabled) return false;
  return prefs.events[event] === true;
}

export function shouldRequestPushPermission(trigger: "click" | "mount"): boolean {
  return trigger === "click";
}

export function validatePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): { ok: true } | { ok: false; message: string } {
  const endpoint = input.endpoint?.trim() ?? "";
  if (endpoint.length < 20 || endpoint.length > 2000 || !endpoint.startsWith("https://")) {
    return { ok: false, message: "That push endpoint is not accepted." };
  }
  let host = "";
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return { ok: false, message: "That push endpoint is not accepted." };
  }
  const known = PUSH_HOSTS.has(host) || host.endsWith(".notify.windows.com");
  if (!known) return { ok: false, message: "That push endpoint is not accepted." };
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(input.p256dh ?? "")) {
    return { ok: false, message: "That push subscription is not valid." };
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.auth ?? "")) {
    return { ok: false, message: "That push subscription is not valid." };
  }
  return { ok: true };
}

export function safeDuelPushUrl(duelId: string): string {
  if (!UUID_RE.test(duelId)) return "/?tab=duels";
  return `/?tab=duels&duel=${duelId}`;
}

export function safeNotificationTarget(raw: string, origin = "https://tap-act.vercel.app"): string {
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.pathname !== "/" || url.searchParams.get("tab") !== "duels") {
      return "/?tab=duels";
    }
    const duel = url.searchParams.get("duel");
    if (duel && !UUID_RE.test(duel)) return "/?tab=duels";
    return safeDuelPushUrl(duel ?? "");
  } catch {
    return "/?tab=duels";
  }
}

export function pushPayload(input: { notificationId: string; title: string; body: string; duelId: string }): string {
  return JSON.stringify({
    title: input.title.slice(0, 80),
    body: input.body.slice(0, 180),
    url: safeDuelPushUrl(input.duelId),
    tag: `tapact-${input.notificationId}`,
  });
}

export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "invalid";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "retry";
  return "dead";
}

export function safeDeliveryError(outcome: Exclude<PushOutcome, "sent">): string {
  if (outcome === "invalid") return "This device's push subscription is no longer valid.";
  if (outcome === "retry") return "The push service did not accept the notice yet.";
  return "This notice could not be delivered.";
}

export function nextPushDelayMs(attemptsAfterFailure: number): number | null {
  if (attemptsAfterFailure >= MAX_PUSH_ATTEMPTS) return null;
  return 60_000 * 2 ** Math.max(0, attemptsAfterFailure - 1);
}

export function isClaimable(row: DeliveryRow, nowMs: number): boolean {
  if ((row.status === "pending" || row.status === "failed") && row.nextAttemptAt <= nowMs && row.attempts < MAX_PUSH_ATTEMPTS) {
    return true;
  }
  return row.status === "sending" && row.claimedAt != null && nowMs - row.claimedAt >= STALE_CLAIM_MS;
}

export function claimBatch(rows: DeliveryRow[], nowMs: number, limit = PUSH_BATCH_LIMIT): { claimed: DeliveryRow[]; rest: DeliveryRow[] } {
  const due = rows
    .filter((row) => isClaimable(row, nowMs))
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
  const taken = new Set(due.map((row) => row.id));
  const claimed = due.map((row) => ({ ...row, status: "sending" as const, claimedAt: nowMs }));
  const rest = rows.map((row) => (taken.has(row.id) ? { ...row, status: "sending" as const, claimedAt: nowMs } : row));
  return { claimed, rest };
}

export async function runPushDispatch(deps: {
  reconcile: () => Promise<void>;
  claim: () => Promise<ClaimedPushDelivery[]>;
  prepare: (id: string, claimToken: string) => Promise<boolean>;
  send: (item: ClaimedPushDelivery) => Promise<{ status: number }>;
  finish: (id: string, claimToken: string, outcome: PushOutcome) => Promise<void>;
}): Promise<PushDispatchSummary> {
  await deps.reconcile();
  const claimed = await deps.claim();
  const summary: PushDispatchSummary = { sent: 0, retried: 0, dropped: 0, failed: 0, skipped: 0 };
  for (const item of claimed) {
    let allowed = false;
    try {
      allowed = await deps.prepare(item.id, item.claimToken);
    } catch {
      summary.failed += 1;
      continue;
    }
    if (!allowed) {
      summary.skipped += 1;
      continue;
    }
    let outcome: PushOutcome = "retry";
    try {
      outcome = classifyPushStatus((await deps.send(item)).status);
    } catch {
      outcome = "retry";
    }
    try {
      await deps.finish(item.id, item.claimToken, outcome);
    } catch {
      summary.failed += 1;
      continue;
    }
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "retry") summary.retried += 1;
    else if (outcome === "invalid") summary.dropped += 1;
    else summary.failed += 1;
  }
  return summary;
}
