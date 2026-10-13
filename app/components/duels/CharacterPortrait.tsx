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
  className = "",
}: {
  character: DuelCharacterPublic | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const accent = accentOf(character?.accent)?.hex ?? "#8E7BFF";
  const src = characterPortraitSrc(character);
  const label = character ? characterLabel(character) : `${name} has not chosen a character`;

  return (
    <div
      className={`relative mx-auto shrink-0 overflow-hidden rounded-[18px] ${SIZES[size]} ${className}`}
      style={{ boxShadow: `0 0 0 1px ${accent}55, 0 0 18px ${accent}22` }}
    >
      <span className="sr-only">{label}</span>
      {!broken ? (
        <img
          src={src}
          alt=""
          width={112}
          height={112}
          className="size-full object-cover object-[50%_16%]"
          onError={() => setBroken(true)}
        />
      ) : (
        <NeutralMark accent={accent} />
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
