"use client";

import { useState } from "react";
import {
  accentOf,
  characterLabel,
  characterPortraitSrc,
  type DuelCharacterPublic,
} from "@/lib/duels/character";

const SIZES = {
  sm: "size-10",
  md: "size-14",
  lg: "size-[4.5rem]",
  xl: "size-[7rem]",
} as const;

export function CharacterPortrait({
  character,
  name,
  size = "md",
  variant = "chip",
  className = "",
}: {
  character: DuelCharacterPublic | null;
  name: string;
  size?: keyof typeof SIZES;
  variant?: "chip" | "stage";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const accent = accentOf(character?.accent)?.hex ?? (character ? "#8E7BFF" : "#5FE3FF");
  const src = characterPortraitSrc(character);
  const label = character ? characterLabel(character) : `${name} has not chosen a character`;
  const stage = variant === "stage";

  return (
    <div
      className={
        stage
          ? `relative isolate h-[6.75rem] w-full overflow-hidden ${className}`
          : `relative mx-auto shrink-0 overflow-hidden rounded-[18px] ${SIZES[size]} ${className}`
      }
      style={stage ? undefined : { boxShadow: `0 0 0 1px ${accent}55, 0 0 18px ${accent}22` }}
    >
      <span className="sr-only">{label}</span>
      {!broken ? (
        <img
          src={src}
          alt=""
          width={stage ? 256 : 112}
          height={stage ? 256 : 112}
          className={stage ? "absolute inset-0 size-full object-cover object-[50%_14%]" : "size-full object-cover object-[50%_16%]"}
          onError={() => setBroken(true)}
        />
      ) : (
        <NeutralMark accent={accent} />
      )}
      {stage && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0a0a10] via-[#0a0a10]/55 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#0a0a10]/70 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#0a0a10]/70 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: `inset 0 0 24px ${accent}22` }}
          />
        </>
      )}
    </div>
  );
}

function NeutralMark({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <rect width="64" height="64" fill="#0d0d13" />
      <circle cx="32" cy="32" r="22" fill="none" stroke={accent} strokeOpacity="0.45" strokeWidth="1.5" />
      <circle cx="32" cy="24" r="8" fill={accent} fillOpacity="0.22" />
      <path d="M16 50c3.2-10 10-15 16-15s12.8 5 16 15" fill={accent} fillOpacity="0.18" />
    </svg>
  );
}
