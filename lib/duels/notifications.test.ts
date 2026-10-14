import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_DELIVERY_LIMIT,
  NOTIFICATION_EVENTS,
  asNotificationPage,
  isMissingNotificationRpc,
  isTimeBasedNotification,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotificationPages,
  notificationAllowsRecipient,
  notificationDedupeKey,
  notificationTimeLabel,
  resolveDuelNotificationTarget,
  timeBasedNotificationReady,
  unreadNotificationCount,
  type NotificationEventType,
} from "./notifications";

const actor = "11111111-1111-4111-8111-111111111111";
const creator = "22222222-2222-4222-8222-222222222222";
const proposer = "33333333-3333-4333-8333-333333333333";
const duelId = "44444444-4444-4444-8444-444444444444";
const proposalId = "55555555-5555-4555-8555-555555555555";

describe("duel notification recipients", () => {
  it("notifies only the invited creator when someone else accepts", () => {
    expect(notificationAllowsRecipient({
      event: "invite_accepted",
      actorId: actor,
      recipientId: creator,
      creatorId: creator,
    })).toBe(true);
    expect(notificationAllowsRecipient({
      event: "invite_accepted",
      actorId: actor,
      recipientId: actor,
      creatorId: creator,
    })).toBe(false);
    expect(notificationAllowsRecipient({
      event: "invite_accepted",
      actorId: creator,
      recipientId: creator,
      creatorId: creator,
    })).toBe(false);
  });

  it("sends proposal events to the other player and keeps the actor out", () => {
    expect(notificationAllowsRecipient({
      event: "proposal_received",
      actorId: proposer,
      recipientId: actor,
      creatorId: creator,
      proposerId: proposer,
    })).toBe(true);
    expect(notificationAllowsRecipient({
      event: "proposal_received",
      actorId: proposer,
      recipientId: proposer,
      creatorId: creator,
      proposerId: proposer,
    })).toBe(false);
    for (const event of ["proposal_approved", "proposal_rejected"] as const) {
      expect(notificationAllowsRecipient({
        event,
        actorId: actor,
        recipientId: proposer,
        creatorId: creator,
        proposerId: proposer,
      })).toBe(true);
      expect(notificationAllowsRecipient({
        event,
        actorId: actor,
        recipientId: actor,
        creatorId: creator,
        proposerId: proposer,
      })).toBe(false);
    }
  });

  it("tells the remaining player when an opponent leaves, not the person who left", () => {
    expect(notificationAllowsRecipient({
      event: "opponent_left",
      actorId: actor,
      recipientId: creator,
      creatorId: creator,
    })).toBe(true);
    expect(notificationAllowsRecipient({
      event: "opponent_left",
      actorId: actor,
      recipientId: actor,
      creatorId: creator,
    })).toBe(false);
  });

  it("still notifies the player who caused a shared outcome they need to see", () => {
    for (const event of ["duel_started", "rules_effective", "duel_finished"] as const) {
      expect(notificationAllowsRecipient({
        event,
        actorId: actor,
        recipientId: actor,
        creatorId: creator,
        proposerId: proposer,
      })).toBe(true);
      expect(isTimeBasedNotification(event)).toBe(true);
    }
  });
});

describe("duel notification dedupe and timing", () => {
  it("builds one stable key per event", () => {
    expect(notificationDedupeKey("invite_accepted", { duelId })).toBe(`invite_accepted:${duelId}`);
    expect(notificationDedupeKey("duel_started", { duelId })).toBe(`duel_started:${duelId}`);
    expect(notificationDedupeKey("duel_finished", { duelId })).toBe(`duel_finished:${duelId}`);
    expect(notificationDedupeKey("proposal_received", { duelId, proposalId })).toBe(`proposal_received:${proposalId}`);
    expect(notificationDedupeKey("proposal_approved", { duelId, proposalId })).toBe(`proposal_approved:${proposalId}`);
    expect(notificationDedupeKey("proposal_rejected", { duelId, proposalId })).toBe(`proposal_rejected:${proposalId}`);
    expect(notificationDedupeKey("rules_effective", { duelId, proposalId })).toBe(`rules_effective:${proposalId}`);
    expect(notificationDedupeKey("opponent_left", { duelId, actorId: actor })).toBe(`opponent_left:${duelId}:${actor}`);
    expect(notificationDedupeKey("invite_accepted", { duelId })).toBe(notificationDedupeKey("invite_accepted", { duelId }));
  });

  it("creates time-based notices only for an active duel, and only once the instant has arrived", () => {
    expect(timeBasedNotificationReady({
      event: "duel_started",
      duelStatus: "active",
      localStartReached: false,
      localEffectiveReached: false,
      bothZonesEnded: false,
      hasOpponent: true,
    })).toBe(false);
    expect(timeBasedNotificationReady({
      event: "duel_started",
      duelStatus: "active",
      localStartReached: true,
      localEffectiveReached: false,
      bothZonesEnded: false,
      hasOpponent: true,
    })).toBe(true);
    expect(timeBasedNotificationReady({
      event: "rules_effective",
      duelStatus: "active",
      localStartReached: true,
      localEffectiveReached: true,
      bothZonesEnded: false,
      hasOpponent: true,
    })).toBe(true);
    expect(timeBasedNotificationReady({
      event: "duel_finished",
      duelStatus: "active",
      localStartReached: true,
      localEffectiveReached: true,
      bothZonesEnded: false,
      hasOpponent: true,
    })).toBe(false);
    expect(timeBasedNotificationReady({
      event: "duel_finished",
      duelStatus: "active",
      localStartReached: true,
      localEffectiveReached: true,
      bothZonesEnded: true,
      hasOpponent: false,
    })).toBe(false);
    expect(timeBasedNotificationReady({
      event: "duel_finished",
      duelStatus: "active",
      localStartReached: true,
      localEffectiveReached: true,
      bothZonesEnded: true,
      hasOpponent: true,
    })).toBe(true);
  });

  it("does not backfill pending, cancelled, or already completed duels from a refresh", () => {
    for (const duelStatus of ["pending", "cancelled", "completed"] as const) {
      for (const event of ["duel_started", "rules_effective", "duel_finished"] as const) {
        expect(timeBasedNotificationReady({
          event,
          duelStatus,
          localStartReached: true,
          localEffectiveReached: true,
          bothZonesEnded: true,
          hasOpponent: true,
        })).toBe(false);
      }
    }
    expect(NOTIFICATION_DELIVERY_LIMIT).toContain("does not run a background scheduler");
    expect(NOTIFICATION_EVENTS).toHaveLength(8);
  });
});

describe("duel notification inbox state", () => {
  const now = Date.parse("2026-10-14T15:00:00.000Z");

  it("marks one notification read without moving an existing read time", () => {
    const items = [
      { id: "a", readAt: null },
      { id: "b", readAt: "2026-10-01T00:00:00.000Z" },
    ];
    const next = markNotificationRead(items, "a", "2026-10-14T15:00:00.000Z");
    expect(next[0].readAt).toBe("2026-10-14T15:00:00.000Z");
    expect(next[1].readAt).toBe("2026-10-01T00:00:00.000Z");
    expect(markNotificationRead(next, "a", "2026-10-14T16:00:00.000Z")[0].readAt).toBe("2026-10-14T15:00:00.000Z");
    expect(unreadNotificationCount(next)).toBe(0);
  });

  it("marks every unread row and ignores duplicates when loading another page", () => {
    const items = [
      { id: "new", readAt: null },
      { id: "old", readAt: "2026-10-01T00:00:00.000Z" },
    ];
    expect(unreadNotificationCount(markAllNotificationsRead(items, "2026-10-14T15:00:00.000Z"))).toBe(0);
    expect(mergeNotificationPages(items, [{ id: "old", readAt: null }, { id: "older", readAt: null }]).map((item) => item.id)).toEqual([
      "new",
      "old",
      "older",
    ]);
  });

  it("labels recent notices and drops unsafe inbox rows", () => {
    expect(notificationTimeLabel("2026-10-14T14:59:30.000Z", now)).toBe("Just now");
    expect(notificationTimeLabel("2026-10-14T14:50:00.000Z", now)).toBe("10m ago");
    expect(notificationTimeLabel("2026-10-14T12:00:00.000Z", now)).toBe("3h ago");
    expect(notificationTimeLabel("2026-10-12T15:00:00.000Z", now)).toBe("2d ago");
    expect(notificationTimeLabel("2026-09-01T15:00:00.000Z", now)).toBe("Sep 1");
    const page = asNotificationPage({
      unread: 2,
      hasMore: true,
      items: [
        {
          id: "1",
          eventType: "proposal_received",
          duelId,
          proposalId,
          title: "Rule change proposed",
          body: "Alex proposed a change.",
          createdAt: "2026-10-14T14:00:00.000Z",
          readAt: null,
        },
        { id: "2", eventType: "timer_tick", duelId, title: "Nope", body: "Hidden", createdAt: "2026-10-14T14:00:00.000Z" },
      ],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].eventType).toBe("proposal_received");
    expect(page.items[0].proposalId).toBe(proposalId);
    expect(page.unread).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(asNotificationPage(null).items).toEqual([]);
  });

  it("recognizes a database that does not have the inbox functions yet", () => {
    expect(isMissingNotificationRpc({ message: "Could not find the function public.tapact_list_notifications" })).toBe(true);
    expect(isMissingNotificationRpc({ message: "You are not in this duel." })).toBe(false);
  });
});

describe("duel notification navigation", () => {
  const duels = [
    { id: duelId, archived: false, status: "active" },
    { id: proposalId, archived: true, status: "completed" },
    { id: actor, archived: false, status: "cancelled" },
  ];

  it("opens an active duel without restoring anything", () => {
    expect(resolveDuelNotificationTarget({ duelId, duels })).toEqual({
      ok: true,
      duelId,
      archived: false,
      restore: false,
    });
  });

  it("opens a personally archived duel without changing membership", () => {
    const target = resolveDuelNotificationTarget({ duelId: proposalId, duels });
    expect(target).toEqual({ ok: true, duelId: proposalId, archived: true, restore: false });
  });

  it("opens a cancelled duel that is still on the account and explains a missing one", () => {
    expect(resolveDuelNotificationTarget({ duelId: actor, duels })).toMatchObject({ ok: true, archived: true, restore: false });
    expect(resolveDuelNotificationTarget({ duelId: creator, duels })).toEqual({
      ok: false,
      message: "This duel isn't available anymore.",
    });
    expect(resolveDuelNotificationTarget({ duelId: "not-a-duel", duels })).toEqual({
      ok: false,
      message: "This duel isn't available anymore.",
    });
    expect(resolveDuelNotificationTarget({ duelId: null, duels }).ok).toBe(false);
  });
});

describe("notification event coverage", () => {
  it("keeps every supported event in the recipient rules", () => {
    const events: NotificationEventType[] = [...NOTIFICATION_EVENTS];
    for (const event of events) {
      expect(typeof notificationAllowsRecipient({
        event,
        actorId: actor,
        recipientId: creator,
        creatorId: creator,
        proposerId: proposer,
      })).toBe("boolean");
    }
  });
});
