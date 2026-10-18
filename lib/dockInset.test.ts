import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DOCK_FLOAT_PX,
  DOCK_INSET_BOOT_SCRIPT,
  PAGE_DOCK_CLEARANCE_PX,
  dockBottomOffsetPx,
  pageBottomPaddingPx,
  syncInstalledDockInset,
  viewportAlreadyClearsBottomInset,
} from "./dockInset";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

type Sample = {
  standalone: boolean;
  layoutHeight: number;
  visualHeight: number;
  offsetTop: number | null;
  innerHeight: number;
  insetPx: number;
  cleared: boolean;
};

const samples: Sample[] = [
  { standalone: false, layoutHeight: 874, visualHeight: 812, offsetTop: 0, innerHeight: 812, insetPx: 34, cleared: false },
  { standalone: true, layoutHeight: 874, visualHeight: 812, offsetTop: 0, innerHeight: 812, insetPx: 34, cleared: true },
  { standalone: true, layoutHeight: 956, visualHeight: 894, offsetTop: 0, innerHeight: 894, insetPx: 34, cleared: true },
  { standalone: true, layoutHeight: 874, visualHeight: 874, offsetTop: 0, innerHeight: 874, insetPx: 34, cleared: false },
  { standalone: true, layoutHeight: 812, visualHeight: 812, offsetTop: 0, innerHeight: 812, insetPx: 34, cleared: false },
  { standalone: true, layoutHeight: 874, visualHeight: 812, offsetTop: 0, innerHeight: 812, insetPx: 0, cleared: false },
  { standalone: true, layoutHeight: 874, visualHeight: 812, offsetTop: 62, innerHeight: 874, insetPx: 34, cleared: false },
  { standalone: true, layoutHeight: 874, visualHeight: 841, offsetTop: 0, innerHeight: 841, insetPx: 34, cleared: true },
  { standalone: true, layoutHeight: 874, visualHeight: 842, offsetTop: 0, innerHeight: 842, insetPx: 34, cleared: false },
  { standalone: true, layoutHeight: 0, visualHeight: 812, offsetTop: 0, innerHeight: 812, insetPx: 34, cleared: false },
  { standalone: true, layoutHeight: 874, visualHeight: 0, offsetTop: null, innerHeight: 812, insetPx: 34, cleared: true },
];

function probeFor(sample: Sample) {
  return {
    style: {
      cssText: "",
      position: "",
      top: "",
      height: "",
      width: "",
      visibility: "",
      pointerEvents: "",
      paddingBottom: "",
    },
    getBoundingClientRect() {
      return { height: sample.layoutHeight };
    },
    remove() {},
  };
}

function visualViewportFor(sample: Sample) {
  if (sample.offsetTop === null) return null;
  return { offsetTop: sample.offsetTop, height: sample.visualHeight };
}

function runBoot(sample: Sample): string | null {
  const attrs = new Map<string, string>();
  const probe = probeFor(sample);
  const sandbox = {
    navigator: { standalone: sample.standalone },
    document: {
      documentElement: {
        appendChild() {
          return probe;
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value);
        },
      },
      createElement() {
        return probe;
      },
    },
    window: {
      innerHeight: sample.innerHeight,
      visualViewport: visualViewportFor(sample),
      getComputedStyle() {
        return { paddingBottom: `${sample.insetPx}px` };
      },
    },
  };
  vm.runInNewContext(DOCK_INSET_BOOT_SCRIPT, sandbox);
  return attrs.get("data-dock-inset") ?? null;
}

function runSync(sample: Sample): string | null {
  let attr: string | null = null;
  const probe = probeFor(sample);
  const win = {
    navigator: { standalone: sample.standalone },
    innerHeight: sample.innerHeight,
    visualViewport: visualViewportFor(sample),
    getComputedStyle() {
      return { paddingBottom: `${sample.insetPx}px` };
    },
    document: {
      createElement() {
        return probe;
      },
      documentElement: {
        appendChild() {
          return probe;
        },
        setAttribute(_name: string, value: string) {
          attr = value;
        },
        removeAttribute() {
          attr = null;
        },
      },
    },
  };
  syncInstalledDockInset(win as unknown as Window & typeof globalThis);
  return attr;
}

describe("dock safe-area clearance", () => {
  it("uses the home-indicator inset once, and only the float when the viewport is already clear", () => {
    for (const sample of samples) {
      const metrics = {
        standalone: sample.standalone,
        safeAreaBottomPx: sample.insetPx,
        layoutHeightPx: sample.layoutHeight,
        visualOffsetTopPx: sample.offsetTop ?? 0,
        visualHeightPx: sample.offsetTop === null ? sample.innerHeight : sample.visualHeight,
      };
      expect(viewportAlreadyClearsBottomInset(metrics), JSON.stringify(sample)).toBe(sample.cleared);
      expect(runBoot(sample), JSON.stringify(sample)).toBe(sample.cleared ? "cleared" : null);
      expect(runSync(sample), JSON.stringify(sample)).toBe(sample.cleared ? "cleared" : null);
    }

    expect(dockBottomOffsetPx(0, false)).toBe(DOCK_FLOAT_PX);
    expect(pageBottomPaddingPx(0, false)).toBe(PAGE_DOCK_CLEARANCE_PX);

    expect(dockBottomOffsetPx(34, false)).toBe(34);
    expect(dockBottomOffsetPx(34, false)).toBeLessThan(DOCK_FLOAT_PX + 34);
    expect(pageBottomPaddingPx(34, false)).toBeCloseTo(PAGE_DOCK_CLEARANCE_PX - DOCK_FLOAT_PX + 34);

    expect(dockBottomOffsetPx(34, true)).toBe(DOCK_FLOAT_PX);
    expect(pageBottomPaddingPx(34, true)).toBe(PAGE_DOCK_CLEARANCE_PX);

    expect(dockBottomOffsetPx(8, false)).toBe(DOCK_FLOAT_PX);
    expect(dockBottomOffsetPx(48, false)).toBe(48);

    const breathing = PAGE_DOCK_CLEARANCE_PX - DOCK_FLOAT_PX;
    for (const inset of [0, 8, 34, 48]) {
      for (const cleared of [false, true]) {
        expect(pageBottomPaddingPx(inset, cleared) - dockBottomOffsetPx(inset, cleared)).toBeCloseTo(breathing);
      }
    }
  });

  it("keeps the pill on the safe edge in CSS and does not stack the float on the inset", () => {
    const css = source("app/globals.css");
    const dock = source("app/components/FocusDock.tsx");
    const page = source("app/page.tsx");
    const layout = source("app/layout.tsx");

    expect(css).toContain("--dock-float: 0.7rem");
    expect(css).toContain("--dock-bottom: max(var(--dock-float), env(safe-area-inset-bottom, 0px))");
    expect(css).toContain("--page-bottom-padding: calc(124px - var(--dock-float) + var(--dock-bottom))");
    expect(css).toContain('html[data-dock-inset="cleared"]');
    expect(css).toContain("--dock-bottom: var(--dock-float)");
    expect(css).not.toContain("0.7rem + env(safe-area-inset-bottom)");
    expect(css).not.toContain("margin-bottom: -");

    expect(dock).toContain("bottom-[var(--dock-bottom)]");
    expect(dock).not.toContain("0.7rem+env(safe-area-inset-bottom)");
    expect(dock).toContain('layoutId="focus-light"');
    expect(dock).toContain("rounded-full");
    expect(dock).toContain("min-h-12");
    expect(page).toContain("pb-[var(--page-bottom-padding)]");
    expect(page).not.toContain("124px+env(safe-area-inset-bottom)");
    expect(layout).toContain("DOCK_INSET_BOOT_SCRIPT");
    expect(DOCK_INSET_BOOT_SCRIPT).toContain("navigator");
    expect(DOCK_INSET_BOOT_SCRIPT).toContain("safe-area-inset-bottom");
    expect(DOCK_INSET_BOOT_SCRIPT).not.toContain("bottom:-");
  });
});
