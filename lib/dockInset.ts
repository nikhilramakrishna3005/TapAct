/**
 * Clearance for the floating bottom nav.
 *
 * The 0.7rem float is the whole gap used when the safe-area inset is 0.
 * On a viewport that actually reaches the screen edge, the home-indicator
 * inset replaces that float. Stacking them lifts the pill into the cards.
 *
 * viewport-fit=cover also exposes a WebKit installed-PWA bug (254868,
 * 313800): position:fixed is attached to a visual viewport that already
 * ends above the home indicator, while env(safe-area-inset-bottom) is
 * still the full indicator inset. Adding it again is a second clearance.
 * That shows up as 100vh (layout) taller than the visual viewport by at
 * least the bottom inset. screen.height is not used — it includes the
 * status bar outside the webview and would drop the pill under the
 * indicator on a normal Home Screen app.
 *
 * navigator.standalone limits the override to an installed iPhone. Safari,
 * Android, and desktop keep max(float, inset).
 */

export const DOCK_FLOAT_PX = 0.7 * 16;
export const PAGE_DOCK_CLEARANCE_PX = 124;
export const BOTTOM_INSET_SLOP_PX = 1;

export function viewportAlreadyClearsBottomInset(input: {
  standalone: boolean;
  safeAreaBottomPx: number;
  layoutHeightPx: number;
  visualOffsetTopPx: number;
  visualHeightPx: number;
}): boolean {
  if (!input.standalone || input.safeAreaBottomPx <= 0) return false;
  if (input.layoutHeightPx <= 0 || input.visualHeightPx <= 0) return false;
  const gap = input.layoutHeightPx - (input.visualOffsetTopPx + input.visualHeightPx);
  return gap >= input.safeAreaBottomPx - BOTTOM_INSET_SLOP_PX;
}

/** Distance from the fixed viewport's bottom edge to the dock's bottom edge. */
export function dockBottomOffsetPx(safeAreaBottomPx: number, viewportAlreadyClear: boolean): number {
  const inset = viewportAlreadyClear ? 0 : Math.max(0, safeAreaBottomPx);
  return Math.max(DOCK_FLOAT_PX, inset);
}

/**
 * Scroll padding that keeps the same breathing room above the dock.
 * At a 16px root and a zero inset this stays 124px.
 */
export function pageBottomPaddingPx(safeAreaBottomPx: number, viewportAlreadyClear: boolean): number {
  return PAGE_DOCK_CLEARANCE_PX - DOCK_FLOAT_PX + dockBottomOffsetPx(safeAreaBottomPx, viewportAlreadyClear);
}

type DockInsetWindow = Window & typeof globalThis;

export function syncInstalledDockInset(win: DockInsetWindow): void {
  const standalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const doc = win.document;
  const probe = doc.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.height = "100vh";
  probe.style.width = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  doc.documentElement.appendChild(probe);
  const layoutHeight = probe.getBoundingClientRect().height;
  probe.style.height = "0";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  const inset = Number.parseFloat(win.getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  const visual = win.visualViewport;
  const cleared = viewportAlreadyClearsBottomInset({
    standalone,
    safeAreaBottomPx: inset,
    layoutHeightPx: layoutHeight,
    visualOffsetTopPx: visual?.offsetTop ?? 0,
    visualHeightPx: visual?.height ?? win.innerHeight,
  });
  if (cleared) doc.documentElement.setAttribute("data-dock-inset", "cleared");
  else doc.documentElement.removeAttribute("data-dock-inset");
}

export const DOCK_INSET_BOOT_SCRIPT = `(function(){try{var nav=navigator;if(!nav||nav.standalone!==true)return;var probe=document.createElement("div");probe.style.cssText="position:fixed;top:0;height:100vh;width:0;visibility:hidden;pointer-events:none";document.documentElement.appendChild(probe);var layoutHeight=probe.getBoundingClientRect().height;probe.style.height="0";probe.style.paddingBottom="env(safe-area-inset-bottom, 0px)";var inset=parseFloat(window.getComputedStyle(probe).paddingBottom)||0;probe.remove();if(!(inset>0)||!(layoutHeight>0))return;var vv=window.visualViewport;var offsetTop=vv?vv.offsetTop:0;var visualHeight=vv&&vv.height?vv.height:window.innerHeight;if(!(visualHeight>0))return;var gap=layoutHeight-(offsetTop+visualHeight);if(gap>=inset-${BOTTOM_INSET_SLOP_PX})document.documentElement.setAttribute("data-dock-inset","cleared");}catch(e){}})();`;
