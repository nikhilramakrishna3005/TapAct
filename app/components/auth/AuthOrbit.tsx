"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, KeyRound, Mail } from "lucide-react";
import { EASE_OUT, SPRING_SNAPPY } from "@/lib/motion";

export type OrbitPose = "sign-in" | "sign-up" | "forgot" | "reset" | "sent" | "done";

const SIZE = 148;
const C = SIZE / 2;
const RING_R = 54;
const OUTER_R = 68;

/** Satellite angle (degrees) per screen, so switching screens sends it along the orbit. */
const POSE_ANGLE: Record<OrbitPose, number> = {
  "sign-in": 0,
  "sign-up": 120,
  forgot: 220,
  reset: 220,
  sent: 300,
  done: 360,
};

const POSE_ICON = { sent: Mail, done: Check, reset: KeyRound, forgot: KeyRound } as const;

export function AuthOrbit({ pose, busy }: { pose: OrbitPose; busy: boolean }) {
  const success = pose === "sent" || pose === "done";
  const Icon = pose in POSE_ICON ? POSE_ICON[pose as keyof typeof POSE_ICON] : null;

  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: SIZE, height: SIZE }} aria-hidden="true">
      <div
        className="absolute inset-[-30%] rounded-full"
        style={{
          background: success
            ? "radial-gradient(closest-side, rgba(108,242,194,0.2), transparent)"
            : "radial-gradient(closest-side, rgba(142,123,255,0.28), rgba(95,227,255,0.06) 60%, transparent)",
          transition: "background var(--dur-slow) var(--ease-out)",
        }}
      />
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative overflow-visible">
        <defs>
          <linearGradient id="auth-orbit-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8E7BFF" />
            <stop offset="1" stopColor="#5FE3FF" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={OUTER_R} fill="none" stroke="var(--orbit)" strokeDasharray="2 7" />
        <g className="ambient-spin" style={{ transformBox: "view-box", transformOrigin: `${C}px ${C}px` }}>
          <circle cx={C} cy={C - OUTER_R} r={2.2} fill="#B9ADFF" opacity={0.8} />
        </g>
        <motion.circle
          cx={C}
          cy={C}
          r={RING_R}
          fill="none"
          stroke={success ? "var(--mint)" : "url(#auth-orbit-ring)"}
          strokeWidth={2.5}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
          transform={`rotate(-90 ${C} ${C})`}
        />
        <circle cx={C} cy={C} r={22} fill={success ? "#6CF2C2" : "#8E7BFF"} fillOpacity={0.16} />
        <motion.g
          initial={false}
          animate={{ rotate: POSE_ANGLE[pose] }}
          transition={{ type: "spring", stiffness: 70, damping: 16 }}
          style={{ transformBox: "view-box", transformOrigin: `${C}px ${C}px` }}
        >
          <g className={busy ? "busy-spin" : undefined} style={{ transformBox: "view-box", transformOrigin: `${C}px ${C}px` }}>
            <circle
              cx={C}
              cy={C - RING_R}
              r={6}
              fill={success ? "var(--mint)" : "var(--ice)"}
              stroke="var(--ink-0)"
              strokeWidth={2.5}
            />
          </g>
        </motion.g>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {Icon ? (
            <motion.span
              key={pose}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={SPRING_SNAPPY}
              className={success ? "text-mint" : "text-text-1"}
            >
              <Icon className="size-5" strokeWidth={2.4} />
            </motion.span>
          ) : (
            <motion.span
              key="core"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={SPRING_SNAPPY}
              className="block size-[18px] rounded-full bg-text-1 shadow-[0_0_24px_rgba(185,173,255,0.6)]"
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
