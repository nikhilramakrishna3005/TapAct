import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { focusTrapTarget, TABBABLE_SELECTOR } from "./dialogFocus";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("dialog focus trap", () => {
  it("wraps Tab and Shift+Tab at the edges and leaves interior moves alone", () => {
    expect(focusTrapTarget(0, -1, false)).toBeNull();
    expect(focusTrapTarget(1, 0, false)).toBe(0);
    expect(focusTrapTarget(1, 0, true)).toBe(0);
    expect(focusTrapTarget(3, 1, false)).toBeNull();
    expect(focusTrapTarget(3, 1, true)).toBeNull();
    expect(focusTrapTarget(3, 2, false)).toBe(0);
    expect(focusTrapTarget(3, 0, true)).toBe(2);
    expect(focusTrapTarget(3, -1, false)).toBe(0);
    expect(focusTrapTarget(3, -1, true)).toBe(2);
  });

  it("selects enabled links, buttons, and fields", () => {
    expect(TABBABLE_SELECTOR).toContain("a[href]");
    expect(TABBABLE_SELECTOR).toContain("button:not([disabled])");
    expect(TABBABLE_SELECTOR).toContain("input:not([disabled]):not([type='hidden'])");
    expect(TABBABLE_SELECTOR).toContain("textarea:not([disabled])");
    expect(TABBABLE_SELECTOR).toContain("select:not([disabled])");
  });

  it("wires the sheet and sync prompt without changing their sheet motion", () => {
    const sheet = source("app/components/ui.tsx");
    const prompt = source("app/components/SyncPrompt.tsx");
    const focus = source("lib/dialogFocus.ts");
    expect(sheet).toContain("useModalDialog(onClose)");
    expect(sheet).toContain("pb-[calc(1.25rem+env(safe-area-inset-bottom))]");
    expect(sheet).toContain("transition={SPRING_SHEET}");
    expect(sheet).toContain('initial={{ y: "100%" }}');
    expect(prompt).toContain("useModalDialog(onClose)");
    expect(prompt).toContain("pb-[calc(1.25rem+env(safe-area-inset-bottom))]");
    expect(prompt).toContain("transition={SPRING_SHEET}");
    expect(prompt).toContain('initial={{ y: "100%" }}');
    expect(focus).toContain('event.key === "Escape"');
    expect(focus).toContain('event.key !== "Tab"');
    expect(focus).toContain("previouslyFocused.focus");
    expect(focus).toContain("preventScroll: true");
  });
});
