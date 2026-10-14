"use client";

import { AnimatePresence, type AnimationSequence, motion, useAnimate } from "motion/react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DURATION, EASE_OUT, TRANSITION_BASE } from "@/lib/motion";
import { DEFAULT_STARTER_IDS, STARTER_PRESETS, type StarterActivity } from "@/lib/onboarding";
import { useMotionPrefs } from "./MotionPrefs";
import { ICON_REGISTRY, tint } from "./ui";

type Step = "welcome" | "how" | "activities" | "goals";
const STEPS: Step[] = ["welcome", "how", "activities", "goals"];
const GOAL_CHOICES = [null, 15, 30, 45, 60, 90, 120] as const;

const RING_CIRCUMFERENCE = 2 * Math.PI * 70;
const ENTRANCE_EASE = [0.22, 1, 0.36, 1] as const;
const RING_EASE = [0.65, 0, 0.35, 1] as const;

/**
 * Welcome entrance (~2s, overlapping): a glowing core appears, its energy ripples
 * outward into the violet-to-cyan orbit, the satellite lands on the ring, then the
 * wordmark, tagline, and call to action rise in. Every element is rendered in its
 * final state; `hidden` only applies the starting pose until the timeline runs.
 */
const ENTRANCE_SEQUENCE = [
  ["[data-splash=core]", { opacity: [0, 1], scale: [0.2, 1] }, { duration: 0.5, ease: ENTRANCE_EASE, at: 0 }],
  ["[data-splash=halo]", { opacity: [0, 0.5], scale: [0.25, 1] }, { duration: 1.1, ease: ENTRANCE_EASE, at: 0.1 }],
  ["[data-splash=wave]", { opacity: [0, 0.5, 0], scale: [0.14, 1.04] }, { duration: 0.85, ease: ENTRANCE_EASE, at: 0.3 }],
  ["[data-splash=ring-body]", { opacity: [0, 1], scale: [0.86, 1] }, { duration: 0.75, ease: ENTRANCE_EASE, at: 0.38 }],
  ["[data-splash=ring]", { strokeDashoffset: [RING_CIRCUMFERENCE, 0] }, { duration: 0.8, ease: RING_EASE, at: 0.38 }],
  ["[data-splash=satellite]", { opacity: [0, 1], scale: [0, 1] }, { duration: 0.4, ease: ENTRANCE_EASE, at: 1.0 }],
  [
    "[data-splash=wordmark]",
    { opacity: [0, 1], y: [18, 0], letterSpacing: ["0.04em", "-0.035em"] },
    { duration: 0.7, ease: ENTRANCE_EASE, at: 1.05 },
  ],
  ["[data-splash=tagline]", { opacity: [0, 1], y: [10, 0] }, { duration: 0.55, ease: ENTRANCE_EASE, at: 1.4 }],
  ["[data-splash=cta]", { opacity: [0, 1], y: [10, 0] }, { duration: 0.5, ease: ENTRANCE_EASE, at: 1.55 }],
] as const;

const SVG_ORIGIN = { transformBox: "fill-box", transformOrigin: "center" } as const;

function hiddenStyle(hidden: boolean): React.CSSProperties | undefined {
  return hidden ? { opacity: 0 } : undefined;
}

function SplashOrbit({ hidden, orbiting }: { hidden: boolean; orbiting: boolean }) {
  return (
    <svg width="208" height="208" viewBox="0 0 208 208" aria-hidden="true" className="overflow-visible">
      <defs>
        <linearGradient id="splash-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8E7BFF" />
          <stop offset="1" stopColor="#5FE3FF" />
        </linearGradient>
        <radialGradient id="splash-glow">
          <stop offset="0" stopColor="#8E7BFF" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#8E7BFF" stopOpacity="0.12" />
          <stop offset="1" stopColor="#8E7BFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        data-splash="halo"
        cx="104"
        cy="104"
        r="100"
        fill="url(#splash-glow)"
        opacity={0.5}
        style={{ ...SVG_ORIGIN, ...hiddenStyle(hidden) }}
      />
      <circle
        data-splash="wave"
        cx="104"
        cy="104"
        r="70"
        fill="none"
        stroke="#B9ADFF"
        strokeWidth="1.5"
        style={{ ...SVG_ORIGIN, opacity: 0 }}
      />
      <g data-splash="ring-body" style={{ ...SVG_ORIGIN, ...hiddenStyle(hidden) }}>
        <circle
          data-splash="ring"
          cx="104"
          cy="104"
          r="70"
          fill="none"
          stroke="url(#splash-ring)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          transform="rotate(-90 104 104)"
          style={{ strokeDashoffset: hidden ? RING_CIRCUMFERENCE : 0 }}
        />
      </g>
      <circle cx="104" cy="104" r="22" fill="#8E7BFF" fillOpacity={0.18} data-splash="core" style={{ ...SVG_ORIGIN, ...hiddenStyle(hidden) }} />
      <circle cx="104" cy="104" r="9" fill="var(--text-1)" data-splash="core" style={{ ...SVG_ORIGIN, ...hiddenStyle(hidden) }} />
      <g
        className={orbiting ? "ambient-spin" : undefined}
        style={{ transformBox: "view-box", transformOrigin: "104px 104px" }}
      >
        <circle
          data-splash="satellite"
          cx="104"
          cy="34"
          r="6"
          fill="#5FE3FF"
          stroke="var(--ink-0)"
          strokeWidth="2"
          style={{ ...SVG_ORIGIN, ...hiddenStyle(hidden) }}
        />
      </g>
    </svg>
  );
}

function DemoTile({
  label,
  color,
  running,
  elapsed,
  onTap,
}: {
  label: string;
  color: string;
  running: boolean;
  elapsed: boolean;
  onTap: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onTap}
      whileTap={{ scale: 0.97 }}
      aria-pressed={running}
      className="flex min-h-[76px] flex-1 flex-col justify-between rounded-[var(--radius-md)] border px-3 py-3 text-left transition-colors"
      style={{
        borderColor: running ? color : "var(--line-strong)",
        background: running ? tint(color, 0.12) : "var(--ink-1)",
      }}
    >
      <span className="text-sm font-semibold text-text-1">{label}</span>
      <span
        className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em]"
        style={{ color: running ? color : "var(--text-3)" }}
      >
        <span
          className={`size-1.5 rounded-full ${running ? "ambient-pulse" : ""}`}
          style={{ background: running ? color : "var(--handle)" }}
        />
        {running ? "Running" : elapsed ? "Paused" : "Ready"}
      </span>
    </motion.button>
  );
}

function HowItWorks() {
  const [active, setActive] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const tap = (id: string) => {
    setTouched((previous) => new Set(previous).add(id));
    setActive((current) => (current === id ? null : id));
  };
  const hint =
    active === null
      ? touched.size === 0
        ? "Try it: tap a tile."
        : "Paused. Time so far is kept."
      : touched.size > 1
        ? "Switched. The other one paused itself."
        : "Running. Tap again to pause, or tap the other to switch.";

  return (
    <div>
      <p className="eyebrow">How it works</p>
      <h2 className="display mt-3 text-[2.1rem]">
        One tap starts.
        <br />
        <span className="text-text-3">One tap stops.</span>
      </h2>
      <ul className="mt-6 space-y-3 text-sm text-text-2">
        {[
          "Tap an activity to start its timer.",
          "Tap it again to pause. Your time is kept.",
          "Tap a different one and TapAct switches over automatically.",
        ].map((line, index) => (
          <li key={line} className="flex gap-3">
            <span className="numeric grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-[0.7rem] text-text-1">
              {index + 1}
            </span>
            <span className="pt-0.5 leading-relaxed">{line}</span>
          </li>
        ))}
      </ul>
      <div className="panel mt-6 p-3">
        <div className="flex gap-2">
          <DemoTile label="Reading" color="#5FE3FF" running={active === "a"} elapsed={touched.has("a")} onTap={() => tap("a")} />
          <DemoTile label="Workout" color="#6CF2C2" running={active === "b"} elapsed={touched.has("b")} onTap={() => tap("b")} />
        </div>
        <p role="status" aria-live="polite" className="mt-3 min-h-[1.25rem] text-center text-xs text-text-3">
          {hint}
        </p>
      </div>
    </div>
  );
}

export function Onboarding({ onFinish }: { onFinish: (starters: StarterActivity[] | null) => void }) {
  const { reduced } = useMotionPrefs();
  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState(1);
  const [entrancePlaying, setEntrancePlaying] = useState(() => !reduced);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const entranceRef = useRef<ReturnType<typeof animate> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_STARTER_IDS);
  const [goals, setGoals] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(STARTER_PRESETS.map((preset) => [preset.id, preset.goalMinutes])),
  );

  useEffect(() => {
    if (!entrancePlaying) {
      return;
    }
    const controls = animate(ENTRANCE_SEQUENCE as unknown as AnimationSequence);
    entranceRef.current = controls;
    let active = true;
    controls.then(() => {
      if (active) {
        setEntrancePlaying(false);
      }
    });
    return () => {
      active = false;
      controls.stop();
    };
    // The entrance plays once on mount; later state changes only finish it early.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishEntrance = () => {
    entranceRef.current?.complete();
    setEntrancePlaying(false);
  };

  useEffect(() => {
    if (reduced && entrancePlaying) {
      finishEntrance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const index = STEPS.indexOf(step);
  const go = (delta: number) => {
    if (entrancePlaying) {
      finishEntrance();
    }
    setDirection(delta);
    setStep(STEPS[Math.min(Math.max(index + delta, 0), STEPS.length - 1)]);
  };

  const toggleStarter = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const finish = () => {
    const starters = STARTER_PRESETS.filter((preset) => selectedIds.includes(preset.id))
      .sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id))
      .map((preset) => ({ ...preset, goalMinutes: goals[preset.id] ?? null }));
    onFinish(starters);
  };

  const selectedPresets = STARTER_PRESETS.filter((preset) => selectedIds.includes(preset.id));

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to TapAct"
      className="fixed inset-0 z-50 overflow-y-auto bg-ink-0"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(70% 45% at 50% 18%, rgba(142,123,255,0.18), transparent 70%), radial-gradient(60% 40% at 50% 110%, rgba(95,227,255,0.07), transparent 70%)",
        }}
      />
      <div
        ref={scope}
        className="relative mx-auto flex min-h-full w-full max-w-[430px] flex-col px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex h-12 items-center justify-between">
          <div className="flex gap-1.5" aria-hidden={step === "welcome"}>
            {step !== "welcome" &&
              STEPS.slice(1).map((item) => (
                <motion.span
                  key={item}
                  className="h-1 rounded-full"
                  initial={false}
                  animate={{
                    width: item === step ? 22 : 8,
                    backgroundColor: STEPS.indexOf(item) <= index ? "var(--volt)" : "var(--track)",
                  }}
                  transition={TRANSITION_BASE}
                />
              ))}
          </div>
          <button
            type="button"
            onClick={() => onFinish(null)}
            className="min-h-11 rounded-full px-4 text-sm font-medium text-text-2 transition-colors hover:text-text-1"
          >
            Skip
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step}
            className="flex flex-1 flex-col"
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          >
            {step === "welcome" && (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <SplashOrbit hidden={entrancePlaying} orbiting={!entrancePlaying} />
                <h1 data-splash="wordmark" className="display mt-6 text-[3rem]" style={hiddenStyle(entrancePlaying)}>
                  TapAct
                </h1>
                <p
                  data-splash="tagline"
                  className="mx-auto mt-3 max-w-[280px] text-[0.95rem] leading-relaxed text-text-2"
                  style={hiddenStyle(entrancePlaying)}
                >
                  Your day, in orbit. Track anything you do with a single tap.
                </p>
              </div>
            )}

            {step === "how" && (
              <div className="flex-1 pt-6">
                <HowItWorks />
              </div>
            )}

            {step === "activities" && (
              <div className="flex-1 pt-6">
                <p className="eyebrow">Make it yours</p>
                <h2 className="display mt-3 text-[2.1rem]">Pick your starters.</h2>
                <p className="mt-3 text-sm leading-relaxed text-text-2">
                  Choose what you want to track. You can add, edit, or archive activities anytime.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2.5">
                  {STARTER_PRESETS.map((preset) => {
                    const selected = selectedIds.includes(preset.id);
                    const Icon = ICON_REGISTRY[preset.iconKey].icon;
                    return (
                      <motion.button
                        key={preset.id}
                        type="button"
                        whileTap={{ scale: 0.97 }}
                        onClick={() => toggleStarter(preset.id)}
                        aria-pressed={selected}
                        className="relative flex min-h-[64px] items-center gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-left transition-colors"
                        style={{
                          borderColor: selected ? tint(preset.color, 0.6) : "var(--line)",
                          background: selected ? tint(preset.color, 0.1) : "var(--ink-1)",
                        }}
                      >
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-xl"
                          style={{ color: preset.color, background: tint(preset.color, 0.14) }}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">
                          {preset.name}
                        </span>
                        <span
                          className="grid size-5 shrink-0 place-items-center rounded-full border transition-colors"
                          style={{
                            borderColor: selected ? preset.color : "var(--line-strong)",
                            background: selected ? preset.color : "transparent",
                          }}
                        >
                          {selected && <Check className="size-3 text-ink-0" strokeWidth={3} />}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === "goals" && (
              <div className="flex-1 pt-6">
                <p className="eyebrow">Optional</p>
                <h2 className="display mt-3 text-[2.1rem]">Set daily goals.</h2>
                <p className="mt-3 text-sm leading-relaxed text-text-2">
                  Goals light up your orbit when you reach them. Leave any at “None”.
                </p>
                <div className="mt-6 space-y-3">
                  {selectedPresets.map((preset) => {
                    const Icon = ICON_REGISTRY[preset.iconKey].icon;
                    return (
                      <div key={preset.id} className="panel px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <Icon className="size-4" style={{ color: preset.color }} />
                          <p className="text-sm font-semibold text-text-1">{preset.name}</p>
                        </div>
                        <div
                          role="group"
                          aria-label={`${preset.name} daily goal`}
                          className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
                        >
                          {GOAL_CHOICES.map((choice) => {
                            const selected = (goals[preset.id] ?? null) === choice;
                            return (
                              <button
                                key={String(choice)}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => setGoals((current) => ({ ...current, [preset.id]: choice }))}
                                className="min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors"
                                style={{
                                  borderColor: selected ? preset.color : "var(--line-strong)",
                                  background: selected ? tint(preset.color, 0.16) : "transparent",
                                  color: selected ? "var(--text-1)" : "var(--text-2)",
                                }}
                              >
                                {choice === null ? "None" : `${choice}m`}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div
          data-splash={step === "welcome" ? "cta" : undefined}
          className="mt-8 flex items-center gap-3"
          style={hiddenStyle(entrancePlaying && step === "welcome")}
        >
          {index > 0 && (
            <button type="button" onClick={() => go(-1)} className="btn btn-ghost size-12 !px-0" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
          )}
          {step === "goals" ? (
            <button type="button" onClick={finish} className="btn btn-primary h-12 flex-1">
              Start tracking
              <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => go(1)}
              disabled={step === "activities" && selectedIds.length === 0}
              className="btn btn-primary h-12 flex-1"
            >
              {step === "welcome" ? "Get started" : "Continue"}
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
        {step === "activities" && selectedIds.length === 0 && (
          <p className="mt-2 text-center text-xs text-text-3">Pick at least one activity to continue.</p>
        )}
      </div>
    </motion.div>
  );
}
