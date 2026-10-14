import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENTS } from "../duels/notifications";
import { cronAuthorized } from "./cron";
import {
  claimBatch,
  classifyPushStatus,
  defaultPushEvents,
  isClaimable,
  nextPushDelayMs,
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
      { id: "1", notificationId: "n1", title: "Invite accepted", body: "Alex accepted.", duelId, endpoint, p256dh, authKey: auth },
      { id: "2", notificationId: "n2", title: "Duel finished", body: "Results are ready.", duelId, endpoint, p256dh, authKey: auth },
      { id: "3", notificationId: "n3", title: "Opponent left", body: "Alex left.", duelId, endpoint, p256dh, authKey: auth },
    ];
    const finished: { id: string; outcome: string }[] = [];
    const summary = await runPushDispatch({
      reconcile: async () => undefined,
      claim: async () => items,
      send: async (item) => ({ status: item.id === "1" ? 201 : item.id === "2" ? 410 : 503 }),
      finish: async (id, outcome) => {
        finished.push({ id, outcome });
      },
    });
    expect(summary).toEqual({ sent: 1, retried: 1, dropped: 1, failed: 0 });
    expect(finished).toEqual([
      { id: "1", outcome: "sent" },
      { id: "2", outcome: "invalid" },
      { id: "3", outcome: "retry" },
    ]);
    expect(classifyPushStatus(404)).toBe("invalid");
    expect(classifyPushStatus(400)).toBe("dead");
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
