export const NOTIFICATION_EVENTS = [
  "invite_accepted",
  "duel_started",
  "proposal_received",
  "proposal_approved",
  "proposal_rejected",
  "rules_effective",
  "duel_finished",
  "opponent_left",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENTS)[number];

export const TIME_BASED_NOTIFICATION_EVENTS = ["duel_started", "rules_effective", "duel_finished"] as const;

export type TimeBasedNotificationEvent = (typeof TIME_BASED_NOTIFICATION_EVENTS)[number];

/** Time-based inbox rows are still created by reconcile. PostgreSQL itself does not schedule them. */
export const NOTIFICATION_DELIVERY_LIMIT =
  "Time-based duel notices are written when a signed-in refresh or the push worker runs. PostgreSQL does not run a background scheduler for them.";

export type DuelNotification = {
  id: string;
  eventType: NotificationEventType;
  duelId: string;
  proposalId: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationPage = {
  unread: number;
  hasMore: boolean;
  items: DuelNotification[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNotificationEvent(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

export function isTimeBasedNotification(event: NotificationEventType): boolean {
  return (TIME_BASED_NOTIFICATION_EVENTS as readonly string[]).includes(event);
}

export function notificationDedupeKey(
  event: NotificationEventType,
  ids: { duelId: string; proposalId?: string | null; actorId?: string | null },
): string {
  switch (event) {
    case "invite_accepted":
    case "duel_started":
    case "duel_finished":
      return `${event}:${ids.duelId}`;
    case "proposal_received":
    case "proposal_approved":
    case "proposal_rejected":
    case "rules_effective":
      return `${event}:${ids.proposalId ?? ""}`;
    case "opponent_left":
      return `${event}:${ids.duelId}:${ids.actorId ?? ""}`;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/**
 * Who may receive each event. Own actions are suppressed except for outcomes
 * both players need: the duel starting, rules taking effect, and final results.
 */
export function notificationAllowsRecipient(input: {
  event: NotificationEventType;
  actorId: string;
  recipientId: string;
  creatorId: string;
  proposerId?: string | null;
}): boolean {
  const { event, actorId, recipientId, creatorId, proposerId } = input;
  if (!recipientId) return false;
  switch (event) {
    case "invite_accepted":
      return recipientId === creatorId && recipientId !== actorId;
    case "proposal_received":
    case "opponent_left":
      return recipientId !== actorId;
    case "proposal_approved":
    case "proposal_rejected":
      return Boolean(proposerId) && recipientId === proposerId && recipientId !== actorId;
    case "duel_started":
    case "rules_effective":
    case "duel_finished":
      return true;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export type DuelNoticeStatus = "pending" | "active" | "completed" | "cancelled";

/**
 * Time-based notices are eligible only while the duel is still active.
 * Already completed duels are not backfilled. Finish still requires both
 * saved time zones to have ended, matching the board.
 */
export function timeBasedNotificationReady(input: {
  event: TimeBasedNotificationEvent;
  duelStatus: DuelNoticeStatus;
  localStartReached: boolean;
  localEffectiveReached: boolean;
  bothZonesEnded: boolean;
  hasOpponent: boolean;
}): boolean {
  if (input.duelStatus !== "active") return false;
  if (input.event === "duel_started") return input.localStartReached;
  if (input.event === "rules_effective") return input.localEffectiveReached;
  return input.hasOpponent && input.bothZonesEnded;
}

export function unreadNotificationCount(items: { readAt: string | null }[]): number {
  return items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);
}

export function markNotificationRead<T extends { id: string; readAt: string | null }>(
  items: T[],
  id: string,
  readAt: string,
): T[] {
  return items.map((item) => (item.id === id && !item.readAt ? { ...item, readAt } : item));
}

export function markAllNotificationsRead<T extends { readAt: string | null }>(items: T[], readAt: string): T[] {
  return items.map((item) => (item.readAt ? item : { ...item, readAt }));
}

export function mergeNotificationPages<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  const next = current.slice();
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

export function notificationTimeLabel(createdAt: string, nowMs: number): string {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return "";
  const delta = Math.max(0, nowMs - created);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "Just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(created));
}

export type DuelNotificationListRef = {
  id: string;
  archived: boolean;
  status: string;
};

export function resolveDuelNotificationTarget(input: {
  duelId: string | null;
  duels: DuelNotificationListRef[];
}): { ok: true; duelId: string; archived: boolean; restore: false } | { ok: false; message: string } {
  const id = input.duelId?.trim() ?? "";
  const unavailable = "This duel isn't available anymore.";
  if (!UUID_RE.test(id)) return { ok: false, message: unavailable };
  const match = input.duels.find((duel) => duel.id === id);
  if (!match) return { ok: false, message: unavailable };
  return {
    ok: true,
    duelId: match.id,
    archived: Boolean(match.archived) || match.status === "cancelled",
    restore: false,
  };
}

export function isMissingNotificationRpc(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  return /could not find the function|schema cache|does not exist|tapact_list_notifications|tapact_reconcile_duel_notifications|tapact_mark_notification_read|tapact_mark_all_notifications_read/i.test(
    message,
  );
}

export function emptyNotificationPage(): NotificationPage {
  return { unread: 0, hasMore: false, items: [] };
}

export function asNotificationPage(raw: unknown): NotificationPage {
  if (!raw || typeof raw !== "object") return emptyNotificationPage();
  const page = raw as { unread?: unknown; hasMore?: unknown; items?: unknown };
  const items = Array.isArray(page.items) ? page.items.flatMap((item) => {
    const row = asNotification(item);
    return row ? [row] : [];
  }) : [];
  return {
    unread: typeof page.unread === "number" && page.unread > 0 ? Math.floor(page.unread) : 0,
    hasMore: page.hasMore === true,
    items,
  };
}

function asNotification(raw: unknown): DuelNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.duelId !== "string") return null;
  if (typeof row.eventType !== "string" || !isNotificationEvent(row.eventType)) return null;
  if (typeof row.title !== "string" || typeof row.body !== "string" || typeof row.createdAt !== "string") return null;
  return {
    id: row.id,
    eventType: row.eventType,
    duelId: row.duelId,
    proposalId: typeof row.proposalId === "string" ? row.proposalId : null,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    readAt: typeof row.readAt === "string" ? row.readAt : null,
  };
}
