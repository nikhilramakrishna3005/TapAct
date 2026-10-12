"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { DURATION, EASE_OUT, TRANSITION_BASE } from "@/lib/motion";
import { DEFAULT_STARTER_IDS, STARTER_PRESETS, type StarterActivity } from "@/lib/onboarding";
import { useMotionPrefs } from "./MotionPrefs";
import { ICON_REGISTRY, tint } from "./ui";

type Step = "welcome" | "how" | "activities" | "goals";
const STEPS: Step[] = ["welcome", "how", "activities", "goals"];
const GOAL_CHOICES = [null, 15, 30, 45, 60, 90, 120] as const;

/** A glowing point that rises onto its orbit, which then draws itself around it. */
function SplashOrbit({ reduced }: { reduced: boolean }) {
  const settle = reduced ? { duration: 0 } : undefined;
  return (
    <svg width="208" height="208" viewBox="0 0 208 208" aria-hidden="true" className="overflow-visible">
      <defs>
        <linearGradient id="splash-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--volt)" />
          <stop offset="1" stopColor="var(--ice)" />
        </linearGradient>
        <radialGradient id="splash-glow">
          <stop offset="0" stopColor="var(--volt)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--volt)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.circle
        cx="104"
        cy="104"
        r="100"
        fill="url(#splash-glow)"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 0.6, scale: 1 }}
        transition={settle ?? { duration: 0.9, ease: EASE_OUT }}
        style={{ transformOrigin: "104px 104px" }}
      />
      <motion.circle
        cx="104"
        cy="104"
        r="70"
        fill="none"
        stroke="url(#splash-ring)"
        strokeWidth="3"
        strokeLinecap="round"
        transform="rotate(-90 104 104)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={settle ?? { duration: 0.8, delay: 0.45, ease: [0.65, 0, 0.35, 1] }}
      />
      <motion.circle
        cx="104"
        cy="104"
        fill="var(--text-1)"
        initial={{ r: 0 }}
        animate={{ r: 9 }}
        transition={settle ?? { duration: 0.35, ease: EASE_OUT }}
      />
      <g
        className="ambient-spin"
        style={{ animationDelay: "1.4s", transformBox: "view-box", transformOrigin: "104px 104px" }}
      >
        <motion.circle
          cx="104"
          fill="var(--ice)"
          initial={{ cy: 104, r: 0 }}
          animate={{ cy: 34, r: 6 }}
          transition={settle ?? { duration: 0.5, delay: 0.25, ease: EASE_OUT }}
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
          style={{ background: running ? color : "rgba(255,255,255,0.3)" }}
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
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_STARTER_IDS);
  const [goals, setGoals] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(STARTER_PRESETS.map((preset) => [preset.id, preset.goalMinutes])),
  );

  const index = STEPS.indexOf(step);
  const go = (delta: number) => {
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
      <div className="relative mx-auto flex min-h-full w-full max-w-[430px] flex-col px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
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
                    backgroundColor: STEPS.indexOf(item) <= index ? "var(--volt)" : "rgba(255,255,255,0.15)",
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
                <SplashOrbit reduced={reduced} />
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduced ? { duration: 0 } : { duration: DURATION.slow, delay: 1.05, ease: EASE_OUT }}
                >
                  <h1 className="display mt-6 text-[3rem]">TapAct</h1>
                  <p className="mx-auto mt-3 max-w-[280px] text-[0.95rem] leading-relaxed text-text-2">
                    Your day, in orbit. Track anything you do with a single tap.
                  </p>
                </motion.div>
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

        <div className="mt-8 flex items-center gap-3">
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
