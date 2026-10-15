"use client";

import { Bell, BellOff } from "lucide-react";
import { notificationStatusSummary } from "@/lib/settingsSummary";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { useCallback, useEffect, useState } from "react";
import { NOTIFICATION_EVENTS, type NotificationEventType } from "@/lib/duels/notifications";
import { enableDevicePush, pauseDevicePush, publicVapidKey, releaseDevicePushSubscription } from "@/lib/push/browser";
import { defaultPushEvents, PUSH_EVENT_LABELS, type PushPreferenceState } from "@/lib/push/delivery";
import { describePushAvailability, eventPreferencePatch, permissionHelp, type PushPlatform } from "@/lib/push/support";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";

type SettingsResponse = {
  pushEnabled?: boolean;
  deviceRegistered?: boolean;
  lastError?: string | null;
  events?: Partial<Record<NotificationEventType, boolean>>;
};

function readPermission(): NotificationPermission | "unknown" {
  if (typeof Notification === "undefined") return "unknown";
  return Notification.permission;
}

export function PushSettings({ platform, installed }: { platform: PushPlatform; installed: boolean }) {
  const auth = useAuth();
  const [prefs, setPrefs] = useState<PushPreferenceState>({ pushEnabled: false, events: defaultPushEvents() });
  const [registered, setRegistered] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unknown">("unknown");
  const [supported, setSupported] = useState({ notification: false, serviceWorker: false, pushManager: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const vapidConfigured = publicVapidKey().length > 0;

  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || auth.status !== "signed-in") return;
    let endpoint: string | null = null;
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      endpoint = (await registration?.pushManager.getSubscription())?.endpoint ?? null;
    }
    const { data, error: rpcError } = await client.rpc("tapact_get_push_settings", { p_endpoint: endpoint });
    if (rpcError) {
      setServerError("Notification settings are not available until the latest database update is applied.");
      return;
    }
    const settings = (data ?? {}) as SettingsResponse;
    const events = defaultPushEvents();
    for (const event of NOTIFICATION_EVENTS) {
      if (typeof settings.events?.[event] === "boolean") events[event] = Boolean(settings.events[event]);
    }
    setPrefs({ pushEnabled: Boolean(settings.pushEnabled), events });
    setRegistered(Boolean(settings.deviceRegistered));
    setServerError(typeof settings.lastError === "string" ? settings.lastError : null);
  }, [auth.status]);

  useEffect(() => {
    setPermission(readPermission());
    const pushManager = typeof window !== "undefined" && "PushManager" in window;
    setSupported({
      notification: typeof Notification !== "undefined",
      serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
      pushManager,
    });
    void load();
  }, [load]);

  const availability = describePushAvailability({
    signedIn: auth.status === "signed-in",
    vapidConfigured,
    hasNotification: supported.notification,
    hasServiceWorker: supported.serviceWorker,
    hasPushManager: supported.pushManager,
    standalone: installed,
    platform,
    permission,
    registered,
    pushEnabled: prefs.pushEnabled,
  });

  const saveEvents = async (events: PushPreferenceState["events"]) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await client.rpc("tapact_set_push_preferences", {
      payload: { pushEnabled: prefs.pushEnabled, events },
    });
    setBusy(false);
    if (rpcError) {
      setError("Couldn't save those notification choices.");
      return;
    }
    setPrefs((current) => ({ ...current, events }));
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableDevicePush();
      setPermission(readPermission());
      await load();
    } catch (caught) {
      setPermission(readPermission());
      setError(caught instanceof Error ? caught.message : "Couldn't enable notifications.");
    } finally {
      setBusy(false);
    }
  };

  const pause = async (pushEnabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await pauseDevicePush(pushEnabled);
      setPrefs((current) => ({ ...current, pushEnabled }));
    } catch {
      setError("Couldn't update push delivery.");
    } finally {
      setBusy(false);
    }
  };

  const disableDevice = async () => {
    setBusy(true);
    setError(null);
    try {
      const released = await releaseDevicePushSubscription();
      if (!released.hadSubscription || released.browserReleased || released.serverReleased) {
        setRegistered(false);
      }
      setPermission(readPermission());
      if (released.hadSubscription && !released.serverReleased) {
        setError("This device could not be removed from the account. It stops once TapAct can reach the server, or when the next account enables notifications here.");
      }
    } catch {
      setError("Couldn't remove this device. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const help = permissionHelp(permission, platform);
  const showEvents = auth.status === "signed-in" && (prefs.pushEnabled || registered);

  return (
    <SettingsDisclosure
      title="Notifications"
      summary={notificationStatusSummary(availability.title)}
      aside={prefs.pushEnabled ? <Bell className="size-4 text-volt-hi" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
    >
      <div className="space-y-3">
        <p className="text-sm font-semibold text-text-1">{availability.title}</p>
        <p className="text-xs leading-relaxed text-text-2">{availability.detail}</p>
        <p className="text-[0.72rem] leading-relaxed text-text-3">
          Push can include an invite, a rule change, a start or finish, or an opponent leaving. It does not include private activities or timer history. Turning push off leaves the in-app inbox in place.
        </p>
        {help && <p className="text-xs leading-relaxed text-ember">{help}</p>}
        {serverError && <p className="text-xs leading-relaxed text-text-3">Last delivery note: {serverError}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}

        {availability.state === "enable" && (
          <button type="button" disabled={busy} onClick={() => void enable()} className="btn btn-primary h-12 w-full">
            Enable push notifications
          </button>
        )}
        {availability.state === "paused" && (
          <button type="button" disabled={busy} onClick={() => void pause(true)} className="btn btn-primary h-12 w-full">
            Resume notifications
          </button>
        )}
        {(availability.state === "enabled" || availability.state === "paused") && (
          <button type="button" disabled={busy} onClick={() => void (availability.state === "enabled" ? pause(false) : disableDevice())} className="btn btn-ghost h-12 w-full">
            {availability.state === "enabled" ? "Pause notifications" : "Disable push on this device"}
          </button>
        )}
        {availability.state === "enabled" && (
          <button type="button" disabled={busy} onClick={() => void disableDevice()} className="min-h-11 w-full text-xs font-semibold text-text-3">
            Disable push on this device
          </button>
        )}

        {showEvents && (
          <ul className="space-y-1 pt-1" aria-label="Push event choices">
            {NOTIFICATION_EVENTS.map((event) => (
              <li key={event}>
                <button
                  type="button"
                  aria-pressed={prefs.events[event]}
                  disabled={busy}
                  onClick={() => void saveEvents(eventPreferencePatch(prefs.events, event, !prefs.events[event]))}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-1 text-left"
                >
                  <span className="text-sm text-text-1">{PUSH_EVENT_LABELS[event]}</span>
                  <span className={`text-xs font-semibold ${prefs.events[event] ? "text-volt-hi" : "text-text-3"}`}>
                    {prefs.events[event] ? "On" : "Off"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsDisclosure>
  );
}
