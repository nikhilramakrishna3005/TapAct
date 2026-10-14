import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { validatePushSubscription } from "./delivery";
import { releasePushSubscription, type PushReleaseResult } from "./release";

export function publicVapidKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
}

export function vapidKeyBytes(publicKey: string): Uint8Array {
  const padded = `${publicKey}${"=".repeat((4 - (publicKey.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

export async function enableDevicePush(): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Push is not available in this browser.");
  }
  const publicKey = publicVapidKey();
  if (!publicKey) throw new Error("Delivery setup incomplete.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications stay off until this browser allows them.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKeyBytes(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  const parsed = validatePushSubscription({
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Sign in to enable notifications on this device.");
  const { error } = await client.rpc("tapact_register_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_expiration: subscription.expirationTime ? new Date(subscription.expirationTime).toISOString() : null,
  });
  if (error) throw error;
  const saved = await client.rpc("tapact_set_push_preferences", { payload: { pushEnabled: true } });
  if (saved.error) throw saved.error;
}

export async function pauseDevicePush(pushEnabled: boolean): Promise<void> {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Sign in to change notification settings.");
  const { error } = await client.rpc("tapact_set_push_preferences", { payload: { pushEnabled } });
  if (error) throw error;
}

/**
 * Best-effort removal for sign-out and "disable on this device".
 * Never throws, and each network or browser step gives up after a short deadline.
 * See releasePushSubscription for the offline limitation.
 */
export async function releaseDevicePushSubscription(): Promise<PushReleaseResult> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { hadSubscription: false, serverReleased: false, browserReleased: false };
  }
  try {
    return await releasePushSubscription({
      lookup: async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) return null;
        return {
          endpoint: subscription.endpoint,
          unsubscribe: () => subscription.unsubscribe(),
        };
      },
      unregister: async (endpoint) => {
        const client = getSupabaseBrowserClient();
        if (!client) return { error: { message: "Sign in to change notification settings." } };
        const { error } = await client.rpc("tapact_unregister_push_subscription", { p_endpoint: endpoint });
        return { error };
      },
    });
  } catch {
    return { hadSubscription: false, serverReleased: false, browserReleased: false };
  }
}
