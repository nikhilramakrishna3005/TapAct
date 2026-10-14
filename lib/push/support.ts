import type { NotificationEventType } from "../duels/notifications";

export type PushPlatform = "ios" | "android" | "other";

export type PushUiState =
  | "signed-out"
  | "setup-incomplete"
  | "install"
  | "unavailable"
  | "blocked"
  | "paused"
  | "enabled"
  | "enable";

export function describePushAvailability(input: {
  signedIn: boolean;
  vapidConfigured: boolean;
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  standalone: boolean;
  platform: PushPlatform;
  permission: NotificationPermission | "unknown";
  registered: boolean;
  pushEnabled: boolean;
}): { state: PushUiState; title: string; detail: string } {
  if (!input.signedIn) {
    return {
      state: "signed-out",
      title: "Enable notifications",
      detail: "Sign in to turn on Duel alerts for this device. Your in-app inbox still works without push.",
    };
  }
  if (!input.vapidConfigured) {
    return {
      state: "setup-incomplete",
      title: "Delivery setup incomplete",
      detail: "Push delivery is not configured for this build yet. Your in-app inbox is unchanged.",
    };
  }
  const apis = input.hasNotification && input.hasServiceWorker && input.hasPushManager;
  if (!apis) {
    if (input.platform === "ios" && !input.standalone) {
      return {
        state: "install",
        title: "Install TapAct to receive notifications",
        detail:
          "On iPhone and iPad, Web Push works in the installed Home Screen app, not in a Safari tab. Tap Share, choose Add to Home Screen, open TapAct from that icon, then enable notifications.",
      };
    }
    return {
      state: "unavailable",
      title: "Push unavailable on this browser",
      detail: "This browser cannot show Web Push alerts. Duel updates still appear in the in-app inbox.",
    };
  }
  if (input.permission === "denied") {
    return {
      state: "blocked",
      title: "Browser permission blocked",
      detail:
        "Notifications are blocked for TapAct. Allow them in this browser or phone's site settings, then return here. TapAct will not ask again until you do.",
    };
  }
  if (input.registered && !input.pushEnabled) {
    return {
      state: "paused",
      title: "Notifications paused",
      detail: "This device is registered, and push delivery is paused. The in-app inbox is still on.",
    };
  }
  if (input.registered && input.pushEnabled) {
    return {
      state: "enabled",
      title: "Notifications enabled on this device",
      detail: "Important Duel updates can arrive while TapAct is closed. Private activities and timer details stay out of the alert.",
    };
  }
  return {
    state: "enable",
    title: "Enable notifications",
    detail: "Alerts use the same Duel notices as your inbox: invites, rule changes, and results. Nothing is sent until you turn this on.",
  };
}

export function permissionHelp(permission: NotificationPermission | "unknown", platform: PushPlatform): string | null {
  if (permission !== "denied") return null;
  if (platform === "ios") {
    return "Open iOS Settings, find TapAct, and allow Notifications. This applies to the Home Screen app, not a Safari tab.";
  }
  return "Open the browser site settings for TapAct and change Notifications from Block to Allow.";
}

export function eventPreferencePatch(
  current: Record<NotificationEventType, boolean>,
  event: NotificationEventType,
  enabled: boolean,
): Record<NotificationEventType, boolean> {
  return { ...current, [event]: enabled };
}
