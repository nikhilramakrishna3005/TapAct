"use client";

import { motion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";

/** The TapAct mark: a tap point at the center and a satellite riding its orbit. */
export function OrbitMark({ size = 28, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="orbit-mark-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--volt)" />
          <stop offset="1" stopColor="var(--ice)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="11" fill="none" stroke="url(#orbit-mark-ring)" strokeWidth="2" opacity="0.9" />
      <circle cx="16" cy="16" r="3.4" fill="var(--text-1)" />
      <g
        className={spin ? "ambient-spin" : undefined}
        style={{ transformBox: "view-box", transformOrigin: "16px 16px" }}
      >
        <circle cx="16" cy="5" r="2.6" fill="var(--ice)" />
      </g>
    </svg>
  );
}

export type OrbitSegment = { id: string; color: string; ms: number };
export type OrbitSatellite = { id: string; color: string; met: boolean; label: string };

const SIZE = 248;
const CENTER = SIZE / 2;
const OUTER_R = 104;
const OUTER_STROKE = 12;
const INNER_R = 80;
const SEGMENT_GAP = 0.008;

function pointOnCircle(radius: number, ratio: number) {
  const angle = ratio * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

/**
 * Today's time as one orbit: each activity is an arc in its own color, laid end to
 * end against the daily target. The comet marks "now" and takes the running
 * activity's color. Goal satellites on the inner orbit light up when met.
 */
export function DayOrbit({
  segments,
  targetMs,
  satellites,
  runningColor,
  complete,
  children,
}: {
  segments: OrbitSegment[];
  targetMs: number;
  satellites: OrbitSatellite[];
  runningColor: string | null;
  complete: boolean;
  children: React.ReactNode;
}) {
  const totalMs = segments.reduce((sum, segment) => sum + segment.ms, 0);
  const scaleMs = Math.max(targetMs, totalMs, 1);
  let cursor = 0;
  const arcs = segments
    .filter((segment) => segment.ms > 0)
    .map((segment) => {
      const length = segment.ms / scaleMs;
      const arc = { ...segment, start: cursor, length };
      cursor += length;
      return arc;
    });
  const endRatio = Math.min(totalMs / scaleMs, 1);
  const comet = pointOnCircle(OUTER_R, endRatio);
  const cometColor = runningColor ?? "var(--text-1)";

  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="overflow-visible">
        <circle
          cx={CENTER}
          cy={CENTER}
          r={OUTER_R}
          fill="none"
          stroke="var(--orbit-dim)"
          strokeWidth={OUTER_STROKE}
        />
        {complete && (
          <motion.circle
            cx={CENTER}
            cy={CENTER}
            r={OUTER_R}
            fill="none"
            stroke="var(--mint)"
            strokeWidth={OUTER_STROKE + 14}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.12 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          />
        )}
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {arcs.map((arc) => {
            const visible = Math.max(arc.length - (arcs.length > 1 ? SEGMENT_GAP : 0), 0.002);
            return (
              <motion.circle
                key={arc.id}
                cx={CENTER}
                cy={CENTER}
                r={OUTER_R}
                fill="none"
                stroke={arc.color}
                strokeWidth={OUTER_STROKE}
                strokeLinecap="round"
                initial={false}
                animate={{ pathLength: visible, pathOffset: arc.start }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
              />
            );
          })}
        </g>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={INNER_R}
          fill="none"
          stroke="var(--orbit)"
          strokeWidth={1}
          strokeDasharray="2 6"
        />
        {satellites.map((satellite, index) => {
          const point = pointOnCircle(INNER_R, index / satellites.length);
          return (
            <motion.circle
              key={satellite.id}
              cx={point.x}
              cy={point.y}
              initial={false}
              animate={{
                r: satellite.met ? 5 : 3.5,
                fill: satellite.met ? satellite.color : "rgba(7,7,11,1)",
              }}
              stroke={satellite.met ? satellite.color : "var(--tick)"}
              strokeWidth={1.5}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            />
          );
        })}
        {runningColor && (
          <motion.circle
            initial={false}
            animate={{ cx: comet.x, cy: comet.y }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
            r={13}
            fill={runningColor}
            opacity={0.22}
            className="ambient-breathe"
          />
        )}
        <motion.circle
          initial={false}
          animate={{ cx: comet.x, cy: comet.y }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          r={6}
          fill={cometColor}
          stroke="var(--ink-0)"
          strokeWidth={2.5}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
