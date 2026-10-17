/**
 * Geometry for the Today orbit.
 *
 * The session clock is an 8-character mono string ("00:00:00") at 2.35rem.
 * It is wider than the old 80px inner ring, so the dashed ticks and goal
 * satellites on that ring ran through the digits. The ring radii below keep
 * the same stroke, the same gap between the two rings, and the same comet
 * margin, and only grow enough for those markers to clear the clock.
 */

export const MONO_ADVANCE_EM = 0.6;
export const NUMERIC_TRACKING_EM = -0.04;
export const ROOT_FONT_PX = 16;

export const OUTER_STROKE = 12;
/** Pixels between the dashed inner ring and the inner edge of the progress stroke. */
export const RING_GAP = 18;
export const SATELLITE_MET_RADIUS = 5;
export const SATELLITE_STROKE = 1.5;
export const DASH_STROKE = 1;
export const COMET_GLOW_RADIUS = 13;
export const EDGE_PAD = 7;
export const MARKER_CLEARANCE = 8;

/** Running session clock in `app/page.tsx`: `text-[2.35rem]`. */
export const RUNNING_CLOCK_REM = 2.35;
/** Idle total in `app/page.tsx`: `text-[2.6rem]`. */
export const IDLE_CLOCK_REM = 2.6;
/** `formatClock` renders `HH:MM:SS` until the session passes 99 hours. */
export const CLOCK_CHARS = 8;
/** `formatSummaryDuration` stays within 7 characters under 100 hours ("23h 59m"). */
export const IDLE_DURATION_CHARS = 7;

export const SATELLITE_INWARD = SATELLITE_MET_RADIUS + SATELLITE_STROKE / 2;

export type GlyphBox = { halfWidth: number; top: number; bottom: number };

export function monoWidth(chars: number, fontRem: number, rootPx = ROOT_FONT_PX): number {
  return chars * fontRem * rootPx * (MONO_ADVANCE_EM + NUMERIC_TRACKING_EM);
}

function line(fontRem: number, rootPx: number, leading = 1.5): number {
  return fontRem * rootPx * leading;
}

/** The running `HH:MM:SS` line, positioned as in the Today orbit stack. */
export function runningClockBox(rootPx = ROOT_FONT_PX): GlyphBox {
  const name = line(0.65, rootPx);
  const before = name + 0.375 * rootPx;
  const clock = RUNNING_CLOCK_REM * rootPx;
  const stack = before + clock + 0.5 * rootPx + line(0.7, rootPx);
  const top = -stack / 2 + before;
  return { halfWidth: monoWidth(CLOCK_CHARS, RUNNING_CLOCK_REM, rootPx) / 2, top, bottom: top + clock };
}

/** The idle total, positioned as in the Today orbit stack. */
export function idleDurationBox(rootPx = ROOT_FONT_PX): GlyphBox {
  const eyebrow = line(0.66, rootPx);
  const before = eyebrow + 0.375 * rootPx;
  const clock = IDLE_CLOCK_REM * rootPx;
  const stack = before + clock + 0.5 * rootPx + line(0.7, rootPx);
  const top = -stack / 2 + before;
  return { halfWidth: monoWidth(IDLE_DURATION_CHARS, IDLE_CLOCK_REM, rootPx) / 2, top, bottom: top + clock };
}

export function distanceToBox(x: number, y: number, box: GlyphBox): number {
  const dx = Math.abs(x) > box.halfWidth ? Math.abs(x) - box.halfWidth : 0;
  const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
  return Math.hypot(dx, dy);
}

/** Smallest gap from a ring of markers to a glyph box. Negative means the marker overlaps the glyphs. */
export function minimumMarkerGap(innerR: number, box: GlyphBox, inward: number): number {
  let min = Infinity;
  for (let deg = 0; deg < 360; deg += 1) {
    const angle = (deg * Math.PI) / 180;
    const gap = distanceToBox(innerR * Math.cos(angle), innerR * Math.sin(angle), box) - inward;
    if (gap < min) min = gap;
  }
  return min;
}

export function innerRadiusFor(boxes: GlyphBox[], clearance = MARKER_CLEARANCE): number {
  let innerR = Math.ceil(Math.max(...boxes.map((box) => box.halfWidth + SATELLITE_INWARD + clearance)));
  const clear = () =>
    boxes.every((box) => minimumMarkerGap(innerR, box, SATELLITE_INWARD) >= clearance - 0.01);
  while (!clear()) innerR += 1;
  return innerR;
}

export function dayOrbitLayout(rootPx = ROOT_FONT_PX) {
  const boxes = [runningClockBox(rootPx), idleDurationBox(rootPx)];
  const innerR = innerRadiusFor(boxes);
  const outerR = innerR + RING_GAP + OUTER_STROKE / 2;
  const center = Math.ceil(outerR + COMET_GLOW_RADIUS + EDGE_PAD);
  return {
    size: center * 2,
    center,
    outerR,
    outerStroke: OUTER_STROKE,
    innerR,
    boxes,
  };
}

export const DAY_ORBIT = dayOrbitLayout();

/** Content width inside the Today column (`max-w-[430px] px-5`) on a given viewport. */
export function todayContentWidth(viewportPx: number): number {
  return Math.min(viewportPx, 430) - 40;
}
