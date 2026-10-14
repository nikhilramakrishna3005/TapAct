import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENTS } from "../duels/notifications";
import { cronAuthorized } from "./cron";
import {
  claimBatch,
  classifyPushStatus,
  defaultPushEvents,
  deliveryLeaseMatches,
  isClaimable,
  nextPushDelayMs,
  PUSH_BATCH_LIMIT,
  pushPayload,
  runPushDispatch,
  safeDuelPushUrl,
  safeNotificationTarget,
  shouldEnqueuePush,
  shouldRequestPushPermission,
  validatePushSubscription,
  type ClaimedPushDelivery,
  type DeliveryRow,
} from "./delivery";
import { releasePushSubscription } from "./release";
import { describePushAvailability, eventPreferencePatch, permissionHelp } from "./support";

const duelId = "44444444-4444-4444-8444-444444444444";
const endpoint = "https://fcm.googleapis.com/fcm/send/device-1";
const p256dh = "A".repeat(87);
const auth = "B".repeat(22);

function row(partial: Partial<DeliveryRow> & Pick<DeliveryRow, "id">): DeliveryRow {
  return {
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: null,
    ...partial,
  };
}

describe("push permission and support", () => {
  it("requests browser permission only from an explicit click", () => {
    expect(shouldRequestPushPermission("mount")).toBe(false);
    expect(shouldRequestPushPermission("click")).toBe(true);
  });

  it("explains install, blocked, paused, and unsupported states from real capabilities", () => {
    expect(describePushAvailability({
      signedIn: true,
      vapidConfigured: true,
      hasNotification: false,
      hasServiceWorker: true,
      hasPushManager: false,
      standalone: false,
      platform: "ios",
      permission: "default",
      registered: false,
      pushEnabled: false,
    }).state).toBe("install");
    expect(describePushAvailability({
      signedIn: true,
      vapidConfigured: true,
      hasNotification: false,
      hasServiceWorker: false,
      hasPushManager: false,
      standalone: true,
      platform: "other",
      permission: "default",
      registered: false,
      pushEnabled: false,
    }).state).toBe("unavailable");
    expect(describePushAvailability({
      signedIn: true,
      vapidConfigured: true,
      hasNotification: true,
      hasServiceWorker: true,
      hasPushManager: true,
      standalone: true,
      platform: "android",
      permission: "denied",
      registered: false,
      pushEnabled: false,
    }).state).toBe("blocked");
    expect(permissionHelp("denied", "ios")).toContain("Home Screen");
    expect(describePushAvailability({
      signedIn: true,
      vapidConfigured: false,
      hasNotification: true,
      hasServiceWorker: true,
      hasPushManager: true,
      standalone: true,
      platform: "other",
      permission: "granted",
      registered: false,
      pushEnabled: false,
    }).state).toBe("setup-incomplete");
    expect(describePushAvailability({
      signedIn: true,
      vapidConfigured: true,
      hasNotification: true,
      hasServiceWorker: true,
      hasPushManager: true,
      standalone: true,
      platform: "other",
      permission: "granted",
      registered: true,
      pushEnabled: false,
    }).state).toBe("paused");
    expect(describePushAvailability({
      signedIn: false,
      vapidConfigured: true,
      hasNotification: true,
      hasServiceWorker: true,
      hasPushManager: true,
      standalone: true,
      platform: "other",
      permission: "default",
      registered: false,
      pushEnabled: false,
    }).state).toBe("signed-out");
  });
});

describe("push subscriptions", () => {
  it("accepts a normal https push endpoint and rejects foreign or malformed keys", () => {
    expect(validatePushSubscription({ endpoint, p256dh, auth }).ok).toBe(true);
    expect(validatePushSubscription({ endpoint: "http://fcm.googleapis.com/fcm/send/x", p256dh, auth }).ok).toBe(false);
    expect(validatePushSubscription({ endpoint: "https://evil.example/push", p256dh, auth }).ok).toBe(false);
    expect(validatePushSubscription({ endpoint, p256dh: "short", auth }).ok).toBe(false);
    expect(validatePushSubscription({ endpoint: "https://web.push.apple.com/push/1", p256dh, auth }).ok).toBe(true);
  });
});

describe("push preferences and payloads", () => {
  it("keeps delivery off until the account opts in, then honors each event", () => {
    expect(shouldEnqueuePush(null, "invite_accepted")).toBe(false);
    expect(shouldEnqueuePush({ pushEnabled: false, events: defaultPushEvents() }, "duel_finished")).toBe(false);
    const events = eventPreferencePatch(defaultPushEvents(), "proposal_received", false);
    expect(shouldEnqueuePush({ pushEnabled: true, events }, "proposal_received")).toBe(false);
    expect(shouldEnqueuePush({ pushEnabled: true, events }, "opponent_left")).toBe(true);
    expect(NOTIFICATION_EVENTS).toHaveLength(8);
  });

  it("builds a same-origin duel link and leaves private activity data out of the payload", () => {
    expect(safeDuelPushUrl(duelId)).toBe(`/?tab=duels&duel=${duelId}`);
    expect(safeDuelPushUrl("nope")).toBe("/?tab=duels");
    expect(safeNotificationTarget("https://evil.example/?tab=duels&duel=" + duelId)).toBe("/?tab=duels");
    expect(safeNotificationTarget(`https://tap-act.vercel.app/?tab=duels&duel=${duelId}`)).toBe(`/?tab=duels&duel=${duelId}`);
    expect(safeNotificationTarget("/api/push/dispatch")).toBe("/?tab=duels");
    const payload = JSON.parse(pushPayload({
      notificationId: "notice-1",
      title: "Duel finished",
      body: "\"Morning\" is finished. Results are ready.",
      duelId,
    })) as Record<string, string>;
    expect(payload).toEqual({
      title: "Duel finished",
      body: "\"Morning\" is finished. Results are ready.",
      url: `/?tab=duels&duel=${duelId}`,
      tag: "tapact-notice-1",
    });
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("minutes");
    expect(payload).not.toHaveProperty("endpoint");
  });
});

describe("push delivery workers", () => {
  const now = 1_000_000;

  it("claims each due row once across two workers and retries with a cap", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", status: "failed", attempts: 2, nextAttemptAt: now }),
      row({ id: "c", status: "sent" }),
      row({ id: "d", status: "sending", claimedAt: now - 11 * 60 * 1000 }),
      row({ id: "e", status: "sending", claimedAt: now - 1000 }),
    ];
    const first = claimBatch(rows, now, 2);
    const second = claimBatch(first.rest, now, 2);
    const ids = [...first.claimed, ...second.claimed].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["a", "b", "d"]);
    expect(isClaimable(row({ id: "fresh", status: "sending", claimedAt: now }), now)).toBe(false);
    expect(nextPushDelayMs(1)).toBe(60_000);
    expect(nextPushDelayMs(3)).toBe(240_000);
    expect(nextPushDelayMs(5)).toBeNull();
  });

  it("marks a send only after the push status is known and drops invalid subscriptions", async () => {
    const items: ClaimedPushDelivery[] = [
      { id: "1", claimToken: "lease-1", notificationId: "n1", title: "Invite accepted", body: "Alex accepted.", duelId, endpoint, p256dh, authKey: auth },
      { id: "2", claimToken: "lease-2", notificationId: "n2", title: "Duel finished", body: "Results are ready.", duelId, endpoint, p256dh, authKey: auth },
      { id: "3", claimToken: "lease-3", notificationId: "n3", title: "Opponent left", body: "Alex left.", duelId, endpoint, p256dh, authKey: auth },
    ];
    const finished: { id: string; claimToken: string; outcome: string }[] = [];
    const summary = await runPushDispatch({
      reconcile: async () => undefined,
      claim: async () => items,
      prepare: async () => true,
      send: async (item) => ({ status: item.id === "1" ? 201 : item.id === "2" ? 410 : 503 }),
      finish: async (id, claimToken, outcome) => {
        finished.push({ id, claimToken, outcome });
      },
    });
    expect(summary).toEqual({ sent: 1, retried: 1, dropped: 1, failed: 0, skipped: 0 });
    expect(finished).toEqual([
      { id: "1", claimToken: "lease-1", outcome: "sent" },
      { id: "2", claimToken: "lease-2", outcome: "invalid" },
      { id: "3", claimToken: "lease-3", outcome: "retry" },
    ]);
    expect(classifyPushStatus(404)).toBe("invalid");
    expect(classifyPushStatus(400)).toBe("dead");
  });

  it("does not send a claim that no longer matches the recipient", async () => {
    const sent: string[] = [];
    const summary = await runPushDispatch({
      reconcile: async () => undefined,
      claim: async () => [
        { id: "old", claimToken: "stale", notificationId: "n1", title: "Invite accepted", body: "Alex accepted.", duelId, endpoint, p256dh, authKey: auth },
        { id: "live", claimToken: "fresh", notificationId: "n2", title: "Duel finished", body: "Results are ready.", duelId, endpoint, p256dh, authKey: auth },
      ],
      prepare: async (id) => id === "live",
      send: async (item) => {
        sent.push(item.id);
        return { status: 201 };
      },
      finish: async () => undefined,
    });
    expect(sent).toEqual(["live"]);
    expect(summary).toEqual({ sent: 1, retried: 0, dropped: 0, failed: 0, skipped: 1 });
  });

  it("refuses a stale lease after the subscription changes accounts", () => {
    expect(deliveryLeaseMatches({
      status: "sending",
      claimToken: "fresh",
      presentedToken: "stale",
      recipientId: "user-a",
      subscriptionUserId: "user-a",
      subscriptionDisabled: false,
    })).toBe(false);
    expect(deliveryLeaseMatches({
      status: "sending",
      claimToken: "fresh",
      presentedToken: "fresh",
      recipientId: "user-a",
      subscriptionUserId: "user-b",
      subscriptionDisabled: false,
    })).toBe(false);
    expect(deliveryLeaseMatches({
      status: "cancelled",
      claimToken: "fresh",
      presentedToken: "fresh",
      recipientId: "user-b",
      subscriptionUserId: "user-b",
      subscriptionDisabled: false,
    })).toBe(false);
    expect(deliveryLeaseMatches({
      status: "sending",
      claimToken: "fresh",
      presentedToken: "fresh",
      recipientId: "user-b",
      subscriptionUserId: "user-b",
      subscriptionDisabled: false,
    })).toBe(true);
  });

  it("keeps two concurrent claimers from taking the same row", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const first = claimBatch(rows, now, PUSH_BATCH_LIMIT);
    const second = claimBatch(first.rest, now, PUSH_BATCH_LIMIT);
    const ids = [...first.claimed, ...second.claimed].map((item) => item.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(new Set(ids).size).toBe(3);
    expect(PUSH_BATCH_LIMIT).toBeLessThanOrEqual(4);
  });

  it("authorizes only a matching scheduler secret", () => {
    const secret = "cron-secret-value-32";
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized("Bearer wrong-secret-value", secret)).toBe(false);
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized(`Bearer ${secret}`, "short")).toBe(false);
    expect(cronAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
  });
});

describe("push migration and service worker", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261014210000_tapact_web_push.sql"), "utf8");
  const worker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  const authProvider = readFileSync(resolve(process.cwd(), "app/components/AuthProvider.tsx"), "utf8");

  it("locks subscriptions to the signed-in user and keeps delivery writes on the server", () => {
    for (const table of ["tapact_push_preferences", "tapact_push_subscriptions", "tapact_push_deliveries"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
    expect(sql).toContain("where user_id = uid and endpoint = p_endpoint");
    expect(sql).toContain("existing.user_id <> uid");
    expect(sql).toContain("perform public.tapact_cancel_open_push_deliveries(existing.id)");
    expect(sql).toContain("on conflict (notification_id, subscription_id) do nothing");
    expect(sql).toContain("for update of d skip locked");
    expect(sql).toContain("n.recipient_id = s.user_id");
    expect(sql).toContain("claim_token = extensions.gen_random_uuid()");
    expect(sql).toContain("row.claim_token is distinct from p_claim_token");
    expect(sql).toContain("owner is distinct from recipient");
    expect(sql).toContain("set status = 'cancelled', claim_token = null");
    expect(sql).toContain("where id = row.subscription_id and user_id = recipient");
    expect(sql).toContain("least(greatest(coalesce(p_batch, 4), 1), 4)");
    expect(sql).toContain("grant execute on function public.tapact_prepare_push_send(uuid, uuid) to service_role");
    expect(sql).toContain("revoke all on function public.tapact_prepare_push_send(uuid, uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.tapact_finish_push_delivery(uuid, uuid, text, text) to service_role");
    expect(sql).not.toContain("delete from public.tapact_notifications");
    expect(sql).not.toContain("grant execute on function public.tapact_prepare_push_send(uuid, uuid) to authenticated");
    expect(sql).toContain("p.push_enabled");
    expect(sql).toContain("public.tapact_push_event_allowed(p, n.event_type)");
    expect(sql).toContain("status = 'sent'");
    expect(sql).toContain("push_enabled boolean not null default false");
    expect(sql).toContain("grant execute on function public.tapact_claim_push_deliveries(integer, text) to service_role");
    expect(sql).toContain("grant execute on function public.tapact_reconcile_due_duel_notifications() to service_role");
    expect(sql).toContain("revoke all on function public.tapact_claim_push_deliveries(integer, text) from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.tapact_reconcile_due_duel_notifications() from public, anon, authenticated");
    expect(sql).not.toContain("grant execute on function public.tapact_claim_push_deliveries(integer, text) to authenticated");
    expect(sql).not.toContain("tapact_time_entries");
    expect(sql).not.toContain("create or replace function public.tapact_duel_member_score");
    expect(sql).not.toContain("create or replace function public.tapact_duel_board");
    expect(sql).toContain("'duel_started:' || d.id::text");
    expect(sql).toContain("where id = d.id and status = 'active'");
    expect(sql).toContain("d0.status = 'active'");
  });

  it("keeps offline shell caching and adds same-origin notification clicks", () => {
    expect(worker).toContain('const CACHE_NAME = "tapact-shell-v2"');
    expect(worker).toContain('self.addEventListener("fetch"');
    expect(worker).toContain("isCacheableAsset");
    expect(worker).toContain('self.addEventListener("push"');
    expect(worker).toContain('self.addEventListener("notificationclick"');
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).not.toContain("supabase");
    expect(worker).not.toContain("tapact_notifications");
  });

  it("releases this device before the account session is cleared", () => {
    const signOut = authProvider.slice(authProvider.indexOf("const signOut"));
    expect(signOut.indexOf("releaseDevicePushSubscription")).toBeGreaterThan(-1);
    expect(signOut.indexOf("releaseDevicePushSubscription")).toBeLessThan(signOut.indexOf("supabase.auth.signOut"));
  });
});

describe("push sign-out", () => {
  const subscription = () => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
    unsubscribe: async () => true,
  });

  it("treats an RPC error as a failed unregister and still unsubscribes the browser", async () => {
    let unsubscribed = 0;
    const result = await releasePushSubscription({
      lookup: async () => ({
        endpoint: subscription().endpoint,
        unsubscribe: async () => {
          unsubscribed += 1;
          return true;
        },
      }),
      unregister: async () => ({ error: { message: "permission denied" } }),
    });
    expect(result).toEqual({ hadSubscription: true, serverReleased: false, browserReleased: true });
    expect(unsubscribed).toBe(1);
  });

  it("still unsubscribes after the unregister request times out", async () => {
    let unsubscribed = 0;
    const result = await releasePushSubscription({
      timeoutMs: 20,
      lookup: async () => ({
        endpoint: subscription().endpoint,
        unsubscribe: async () => {
          unsubscribed += 1;
          return true;
        },
      }),
      unregister: () => new Promise((resolve) => {
        setTimeout(() => resolve({ error: null }), 200);
      }),
    });
    expect(result.serverReleased).toBe(false);
    expect(result.browserReleased).toBe(true);
    expect(unsubscribed).toBe(1);
  });

  it("survives a revoked permission and a repeated unsubscribe failure", async () => {
    const result = await releasePushSubscription({
      lookup: async () => ({
        endpoint: subscription().endpoint,
        unsubscribe: async () => {
          throw new Error("permission revoked");
        },
      }),
      unregister: async () => ({ error: null }),
    });
    expect(result).toEqual({ hadSubscription: true, serverReleased: true, browserReleased: false });
    const again = await releasePushSubscription({
      lookup: async () => {
        throw new Error("no service worker");
      },
      unregister: async () => ({ error: null }),
    });
    expect(again).toEqual({ hadSubscription: false, serverReleased: false, browserReleased: false });
  });
});
