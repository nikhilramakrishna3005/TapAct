import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aboutSummary,
  appearanceSummary,
  dataBackupSummary,
  installSummary,
  motionSummary,
  notificationStatusSummary,
} from "./settingsSummary";
import { formatTodayHeaderDate } from "./todayLabel";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Today header", () => {
  it("uses a short weekday date in the viewer locale", () => {
    const ms = new Date(2026, 9, 14, 12).getTime();
    expect(formatTodayHeaderDate(ms, "en-US")).toBe("Wed, Oct 14");
    expect(formatTodayHeaderDate(new Date(2026, 9, 15, 12).getTime(), "en-US")).toBe("Thu, Oct 15");
  });

  it("keeps the profile control and leaves the notification bell off Today", () => {
    const page = source("app/page.tsx");
    const today = page.slice(page.indexOf("tab === \"settings\""), page.indexOf("persistFailure &&"));
    expect(today).toContain("formatTodayHeaderDate");
    expect(today).toContain("Account settings");
    expect(today).toContain("Sign in or create an account");
    expect(today).not.toContain("NotificationBellButton");
    expect(page).not.toContain("NotificationBellButton");
    const inbox = source("app/components/duels/NotificationInbox.tsx");
    expect(inbox).toContain("NotificationBellButton");
    expect(inbox).toContain("<Bell");
  });
});

describe("Insights spacing", () => {
  it("keeps the original statistics arrangement and only tightens the heading gap", () => {
    const view = source("app/components/InsightsView.tsx");
    expect(view).toContain('title="See where your time goes."');
    expect(view).toContain('className="mt-3 flex items-end justify-between gap-4"');
    expect(view).toContain("This week");
    expect(view).toContain("text-[2.9rem]");
    expect(view).toContain(">Today<");
    expect(view).toContain("This month");
    expect(view).not.toContain("grid-cols-3");
    expect(view).not.toContain("mt-6 flex items-end");
  });
});

describe("Duels refresh and copy", () => {
  it("keeps one accessible refresh control on the existing fetch", () => {
    const view = source("app/components/DuelsView.tsx");
    expect(view).toContain('aria-label="Refresh duels"');
    expect(view).toContain("aria-busy={refreshing}");
    expect(view).toContain("disabled={refreshing}");
    expect(view).toContain("refreshLock.current");
    expect(view).toContain("await loadList({ history: false })");
    expect(view).toContain("await loadBoard(selectedRef.current)");
    expect(view).not.toContain(">Refresh</button>");
    expect(view.match(/Refresh duels/g)).toHaveLength(1);
  });

  it("shortens the showcase line and keeps the streak explanation available", () => {
    const showcase = source("app/components/duels/BattleShowcase.tsx");
    expect(showcase).toContain("Your duel record and consistency streaks.");
    expect(showcase).toContain("How streaks work");
    expect(showcase).toContain("A consistency day is one where every target was met.");
  });
});

describe("Settings summaries", () => {
  it("describes the real preference and sync state", () => {
    expect(appearanceSummary("light")).toBe("Light");
    expect(appearanceSummary("dark")).toBe("Dark");
    expect(appearanceSummary("system")).toBe("System");
    expect(motionSummary("expressive")).toBe("Expressive");
    expect(motionSummary("subtle")).toBe("Subtle");
    expect(installSummary(true)).toBe("Installed");
    expect(installSummary(false)).toBe("Add TapAct to your device");
    expect(dataBackupSummary("Healthy", false)).toBe("On this device");
    expect(dataBackupSummary("Healthy", true)).toBe("On this device, synced to your account");
    expect(dataBackupSummary("Full", true)).toBe("Full");
    expect(aboutSummary("0.1.0")).toBe("TapAct 0.1.0");
    expect(notificationStatusSummary("Notifications enabled on this device")).toBe("Enabled on this device");
    expect(notificationStatusSummary("Notifications paused")).toBe("Paused");
    expect(notificationStatusSummary("Push unavailable on this browser")).toBe("Unavailable");
  });

  it("keeps the original header and makes every control reachable", () => {
    const settings = source("app/components/SettingsView.tsx");
    expect(settings).toContain('title="Your data, on your device."');
    expect(settings).not.toContain("Your account, appearance, and preferences");
    expect(settings).toContain('title="Appearance"');
    expect(settings).toContain('title="Motion"');
    expect(settings).toContain('title="Install TapAct"');
    expect(settings).toContain('title="Data & Backup"');
    expect(settings).toContain("Export data");
    expect(settings).toContain("Import data");
    expect(settings).toContain('title="About"');
    const disclosure = source("app/components/SettingsDisclosure.tsx");
    expect(disclosure).toContain("aria-expanded={open}");
    expect(disclosure).toContain("aria-controls={panelId}");
    expect(disclosure).toContain('type="button"');
    expect(disclosure).toContain("min-h-11");
    const account = source("app/components/AccountSection.tsx");
    expect(account).toContain("{account.email}");
    expect(account).toContain("Email verified");
    expect(account).toContain("Email not verified");
    expect(account).toContain("<SyncStatusBadge />");
    expect(account).toContain("{style.label}");
    expect(account).toContain("Manage account");
    expect(account).toContain("Sync now");
    expect(account).toContain("Sign out");
    expect(account).toContain("Review this device");
    expect(account).toContain("aria-expanded={open}");
    const push = source("app/components/PushSettings.tsx");
    expect(push).toContain('title="Notifications"');
    expect(push).toContain("Enable push notifications");
    expect(push).toContain("Pause notifications");
    expect(push).toContain("Disable push on this device");
    expect(push).toContain("Push event choices");
  });
});

describe("Installed app safe area", () => {
  it("covers the screen and keeps the existing inset padding", () => {
    const layout = source("app/layout.tsx");
    expect(layout).toContain('viewportFit: "cover"');
    expect(layout).toContain('width: "device-width"');
    expect(layout).toContain("initialScale: 1");
    expect(layout).toContain('title: "TapAct"');
    expect(layout).toContain('"apple-mobile-web-app-capable": "yes"');
    expect(layout).toContain("/pwa-icons/apple-touch-icon.png");
    expect(layout).toContain('sizes: "180x180"');
    expect(layout).not.toContain("statusBarStyle");

    const dock = source("app/components/FocusDock.tsx");
    expect(dock).toContain("bottom-[var(--dock-bottom)]");
    expect(dock).not.toContain("0.7rem+env(safe-area-inset-bottom)");
    expect(dock).toContain("layoutId=\"focus-light\"");

    const page = source("app/page.tsx");
    expect(page).toContain("pb-[var(--page-bottom-padding)]");
    expect(page).not.toContain("124px+env(safe-area-inset-bottom)");
    expect(page).toContain("pt-[calc(0.75rem+env(safe-area-inset-top))]");
    expect(page).toContain("top-[calc(0.75rem+env(safe-area-inset-top))]");

    const sheet = source("app/components/ui.tsx");
    expect(sheet).toContain("pb-[calc(1.25rem+env(safe-area-inset-bottom))]");
    expect(sheet).toContain("max-h-[92vh]");
    const prompt = source("app/components/SyncPrompt.tsx");
    expect(prompt).toContain("pb-[calc(1.25rem+env(safe-area-inset-bottom))]");

    const invite = source("app/components/duels/DuelInvite.tsx");
    expect(invite).toContain("pb-[calc(2rem+env(safe-area-inset-bottom))]");
    expect(invite).toContain("pt-[calc(2rem+env(safe-area-inset-top))]");
  });
});

describe("Tab navigation", () => {
  it("shows the next tab on the same update instead of waiting for an exit", () => {
    const page = source("app/page.tsx");
    const mainStart = page.indexOf("<motion.main");
    const tabStart = page.indexOf("<div key={tab}>", mainStart);
    const shell = page.slice(mainStart, page.indexOf('tab === "insights"', tabStart));
    expect(shell).toContain("<div key={tab}>");
    expect(shell).not.toContain("AnimatePresence");
    expect(shell).not.toContain('mode="wait"');
    expect(shell).not.toContain("exit=");
    expect(page).toContain("window.scrollTo({ top: 0 })");
    expect(page.indexOf("<CloudSyncProvider")).toBeLessThan(tabStart);
    expect(page.indexOf("<DuelNotificationProvider")).toBeLessThan(tabStart);
    expect(page.indexOf("<FocusDock")).toBeGreaterThan(page.indexOf("</motion.main>"));
  });
});
