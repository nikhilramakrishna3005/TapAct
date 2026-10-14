"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import {
  DUEL_ACCENT_CATALOG,
  DUEL_ARCHETYPE_CATALOG,
  DUEL_TITLES,
  accentOf,
  appearanceOf,
  archetypeOf,
  defaultCharacterDraft,
  type DuelArchetypeId,
  type DuelCharacterPublic,
} from "@/lib/duels/character";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { useMotionPrefs } from "../MotionPrefs";
import { Sheet } from "../ui";
import { CharacterPortrait } from "./CharacterPortrait";

export function ChooseCharacter({
  mode,
  current,
  busy,
  onSave,
  onSkip,
  onClose,
}: {
  mode: "choose" | "change" | "customize";
  current: DuelCharacterPublic | null;
  busy: boolean;
  onSave: (character: DuelCharacterPublic) => Promise<void>;
  onSkip?: () => void;
  onClose: () => void;
}) {
  const motionPrefs = useMotionPrefs();
  const [step, setStep] = useState<"pick" | "customize">(mode === "customize" ? "customize" : "pick");
  const [draft, setDraft] = useState<DuelCharacterPublic>(current ?? defaultCharacterDraft());
  const archetype = archetypeOf(draft.archetype) ?? DUEL_ARCHETYPE_CATALOG[0];
  const appearance = appearanceOf(archetype, draft.appearance) ?? archetype.appearances[0];
  const accent = accentOf(draft.accent) ?? DUEL_ACCENT_CATALOG[0];
  const label = mode === "customize" ? "Customize character" : mode === "change" ? "Change character" : "Choose your character";
  const canSkip = mode === "choose" && Boolean(onSkip);
  const enter = useMemo(
    () => (motionPrefs.reduced ? { duration: 0 } : { duration: DURATION.quick, ease: EASE_OUT }),
    [motionPrefs.reduced],
  );

  const pick = (id: DuelArchetypeId) => {
    const next = archetypeOf(id);
    if (!next) return;
    setDraft((currentDraft) => {
      const keepAppearance = appearanceOf(next, currentDraft.appearance);
      return {
        archetype: next.id,
        appearance: keepAppearance?.id ?? next.appearances[0].id,
        accent: currentDraft.archetype === next.id ? currentDraft.accent : next.defaultAccent,
        title: currentDraft.title,
      };
    });
    setStep("customize");
  };

  return (
    <Sheet label={label} onClose={busy ? () => undefined : onClose}>
      {step === "pick" ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-text-2">
            Pick who represents you in the arena. Characters are cosmetic and never change scores, targets, or permissions.
          </p>
          <ul className="mt-4 space-y-2">
            {DUEL_ARCHETYPE_CATALOG.map((item, index) => {
              const preview = {
                archetype: item.id,
                appearance: item.appearances[0].id,
                accent: item.defaultAccent,
                title: draft.title,
              } satisfies DuelCharacterPublic;
              const selected = draft.archetype === item.id && Boolean(current);
              return (
                <li key={item.id}>
                  <motion.button
                    type="button"
                    initial={motionPrefs.reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...enter, delay: motionPrefs.reduced ? 0 : index * 0.04 }}
                    onClick={() => pick(item.id)}
                    className={`flex min-h-[5.5rem] w-full items-center gap-3 rounded-[20px] border px-3 py-3 text-left ${
                      selected ? "border-volt/50 bg-volt/[0.07]" : "border-line bg-ink-0"
                    }`}
                  >
                    <CharacterPortrait character={preview} name={item.name} size="lg" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text-1">{item.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-text-3">{item.description}</span>
                    </span>
                  </motion.button>
                </li>
              );
            })}
          </ul>
          {canSkip && (
            <button type="button" disabled={busy} onClick={onSkip} className="btn btn-ghost mt-4 h-12 w-full">
              Skip for now
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <motion.div
            initial={motionPrefs.reduced ? false : { opacity: 0.7, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={enter}
            className="rounded-[22px] border border-line bg-[radial-gradient(120%_90%_at_50%_0%,rgba(142,123,255,0.16),transparent_55%),var(--ink-1)] px-4 py-4 text-center"
            style={{ boxShadow: `inset 0 0 40px ${accent.hex}14` }}
          >
            <CharacterPortrait character={draft} name={archetype.name} size="xl" />
            <p className="mt-3 text-base font-semibold text-text-1">{archetype.name}</p>
            <p className="text-xs text-text-3">{appearance.name} · {draft.title}</p>
          </motion.div>

          <fieldset className="mt-4">
            <legend className="eyebrow">Appearance</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {archetype.appearances.map((item) => {
                const next = { ...draft, appearance: item.id };
                const selected = draft.appearance === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft(next)}
                    className={`min-h-11 rounded-2xl border px-2 py-2 ${selected ? "border-volt/60 bg-volt/[0.08]" : "border-line bg-ink-0"}`}
                  >
                    <CharacterPortrait character={next} name={item.name} size="sm" />
                    <span className="mt-1 block text-[0.7rem] font-semibold text-text-1">{item.name}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="eyebrow">Accent</legend>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
              {DUEL_ACCENT_CATALOG.map((item) => {
                const selected = draft.accent === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={item.name}
                    onClick={() => setDraft({ ...draft, accent: item.id })}
                    className={`grid size-11 place-items-center rounded-full border ${selected ? "border-text-1" : "border-transparent"}`}
                  >
                    <span className="size-7 rounded-full" style={{ background: item.hex }} />
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="eyebrow">Display title</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DUEL_TITLES.map((title) => {
                const selected = draft.title === title;
                return (
                  <button
                    key={title}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft({ ...draft, title })}
                    className={`min-h-11 rounded-full border px-3 text-xs font-semibold ${
                      selected ? "border-volt/60 text-text-1" : "border-line text-text-3"
                    }`}
                  >
                    {title}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              className="btn btn-primary h-12 w-full"
              onClick={() => void onSave(draft)}
            >
              {busy ? "Saving…" : current ? "Save character" : "Choose this character"}
            </button>
            {mode !== "customize" && (
              <button type="button" disabled={busy} onClick={() => setStep("pick")} className="btn btn-ghost h-12 w-full">
                Back to characters
              </button>
            )}
            {canSkip && (
              <button type="button" disabled={busy} onClick={onSkip} className="min-h-11 text-sm font-medium text-text-3">
                Skip for now
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
