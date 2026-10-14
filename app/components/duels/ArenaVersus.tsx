"use client";

import {
  arenaLead,
  arenaReactions,
  dayHasMetTarget,
  friendIsLive,
  leadCopy,
  momentumShares,
  victoryPresentation,
  youAreTrackingDuel,
} from "@/lib/duels/arena";
import { accentOf, type DuelCharacterPublic } from "@/lib/duels/character";
import type { BoardDay } from "@/lib/duels/api";
import { CharacterPortrait } from "./CharacterPortrait";

export function ArenaVersus({
  youName,
  friendName,
  youScore,
  friendScore,
  youStreak,
  friendStreak,
  youCharacter,
  friendCharacter,
  youStatus,
  friendStatus,
  youToday,
  friendToday,
  mappings,
  activeActivityId,
  presence,
  final,
  winner,
  unsynced,
  awaitingOpponent,
}: {
  youName: string;
  friendName: string;
  youScore: number;
  friendScore: number | null;
  youStreak: number;
  friendStreak: number;
  youCharacter: DuelCharacterPublic | null;
  friendCharacter: DuelCharacterPublic | null;
  youStatus: string;
  friendStatus: string | null;
  youToday?: BoardDay;
  friendToday?: BoardDay;
  mappings: { trackerActivityId: string }[];
  activeActivityId: string | null;
  presence: { name: string; activity: string } | null;
  final: boolean;
  winner: "you" | "friend" | "tie" | null;
  unsynced: boolean;
  awaitingOpponent: boolean;
}) {
  const lead = arenaLead(youScore, friendScore);
  const momentum = momentumShares(youScore, friendScore);
  const youTracking = youAreTrackingDuel({ youStatus, activeActivityId, mappings });
  const live = friendIsLive({ friendStatus, presence });
  const reactions = arenaReactions({
    lead,
    youTracking,
    friendLive: live,
    youMetToday: dayHasMetTarget(youToday?.activities),
    friendMetToday: dayHasMetTarget(friendToday?.activities),
    final,
  });
  const victory = victoryPresentation({
    final,
    unsynced,
    winner,
    youScore,
    friendScore: friendScore ?? 0,
    youStreak,
    friendStreak,
    friendName,
  });
  const liveLabel = friendStatus === "left"
    ? "Left the duel"
    : live
      ? `${presence?.name} is ${presence?.activity.toLowerCase()}`
      : awaitingOpponent
        ? "Invite open"
        : null;

  return (
    <div className="relative mt-2 overflow-hidden rounded-[20px] border border-line" role="region" aria-label="Character versus arena">
      <div
        aria-hidden
        className="arena-stage pointer-events-none absolute inset-0"
      />

      <div className="relative">
        <div className="relative">
          <div className="grid grid-cols-2 gap-5 px-2 pt-2">
            <PortraitFrame
              name={youName}
              character={youCharacter}
              side="you"
              leading={reactions.youLead}
              live={reactions.youLive}
              achieved={reactions.youAchieved}
              winner={victory?.kind === "you"}
            />
            <PortraitFrame
              name={friendName}
              character={friendCharacter}
              side="friend"
              leading={reactions.friendLead}
              live={reactions.friendLive}
              achieved={reactions.friendAchieved}
              winner={victory?.kind === "friend"}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="sr-only">versus</span>
            <VsEmblem energy={reactions.vsEnergy} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5 px-2 pb-1.5 pt-1.5">
          <PlayerMeta name={youName} character={youCharacter} score={youScore} streak={youStreak} side="you" liveLabel={null} />
          <PlayerMeta name={friendName} character={friendCharacter} score={friendScore ?? 0} streak={friendStreak} side="friend" liveLabel={liveLabel} />
        </div>
      </div>

      <p className={`relative px-2 text-center text-[0.65rem] font-medium ${lead === "you" ? "text-volt-hi" : lead === "friend" ? "text-ice" : "text-text-3"}`}>
        {leadCopy(lead)}
      </p>

      <div className="relative px-3 pb-2.5 pt-1.5">
        <p className="sr-only">
          {momentum.awaiting
            ? `Your score is ${youScore}. Your friend has not joined.`
            : `Score comparison ${youScore} to ${friendScore ?? 0}. ${leadCopy(lead)}.`}
        </p>
        <div className="flex h-1 overflow-hidden rounded-full bg-[var(--track)]" aria-hidden>
          <div
            className="h-full bg-volt transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${momentum.youPercent}%` }}
          />
          <div
            className="h-full bg-ice transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${momentum.friendPercent}%` }}
          />
        </div>
        <p className="mt-1 text-center text-[0.62rem] text-text-3">
          {momentum.awaiting ? `${youScore} pts · waiting` : `${youScore}–${friendScore}`}
        </p>
      </div>

      {victory && (
        <div
          className={`relative mx-2 mb-2 flex items-center gap-2 rounded-[14px] border px-2 py-1.5 ${
            victory.kind === "tie" || victory.kind === "provisional"
              ? "border-line-strong bg-ink-0/70"
              : victory.kind === "you"
                ? "border-volt/35 bg-volt/[0.08]"
                : "border-ice/35 bg-ice/[0.08]"
          }`}
        >
          {victory.kind === "tie" ? (
            <div className="flex shrink-0 -space-x-2">
              <CharacterPortrait character={youCharacter} name={youName} size="sm" className="mx-0" />
              <CharacterPortrait character={friendCharacter} name={friendName} size="sm" className="mx-0" />
            </div>
          ) : (
            <CharacterPortrait
              character={victory.kind === "friend" ? friendCharacter : youCharacter}
              name={victory.kind === "friend" ? friendName : youName}
              size="sm"
              className="mx-0"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-1">{victory.title}</p>
            <p className="text-[0.68rem] leading-snug text-text-3">{victory.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function PortraitFrame({
  name,
  character,
  side,
  leading,
  live,
  achieved,
  winner,
}: {
  name: string;
  character: DuelCharacterPublic | null;
  side: "you" | "friend";
  leading: boolean;
  live: boolean;
  achieved: boolean;
  winner: boolean;
}) {
  const accent = accentOf(character?.accent)?.hex ?? (side === "you" ? "#8E7BFF" : "#5FE3FF");
  return (
    <div className="relative min-w-0">
      {live && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[16px]"
          style={{ boxShadow: `inset 0 0 20px ${accent}50` }}
        />
      )}
      <div
        className="relative overflow-hidden rounded-[16px]"
        style={{
          boxShadow: leading || winner ? `0 0 0 1px ${accent}55, 0 8px 20px -14px ${accent}` : undefined,
        }}
      >
        <CharacterPortrait character={character} name={name} variant="stage" />
        {achieved && (
          <span className="absolute right-1.5 top-1.5 z-[1] size-1.5 rounded-full bg-mint" aria-hidden />
        )}
      </div>
    </div>
  );
}

function PlayerMeta({
  name,
  character,
  score,
  streak,
  side,
  liveLabel,
}: {
  name: string;
  character: DuelCharacterPublic | null;
  score: number;
  streak: number;
  side: "you" | "friend";
  liveLabel: string | null;
}) {
  return (
    <div className="min-w-0 text-center">
      <p className="truncate text-xs font-semibold text-text-1">{name}</p>
      <p className="truncate text-[0.6rem] text-text-3">{character?.title ?? (side === "friend" ? "Awaiting character" : "Ready to appear")}</p>
      <p className="numeric mt-0.5 text-[1.45rem] font-semibold leading-none text-text-1">{score}</p>
      <p className="mt-0.5 text-[0.6rem] text-text-3">{streak > 0 ? `${streak}-day streak` : "No streak yet"}</p>
      {liveLabel && <p className="mt-0.5 truncate text-[0.6rem] text-ice">{liveLabel}</p>}
    </div>
  );
}

function VsEmblem({ energy }: { energy: boolean }) {
  return (
    <div
      className={`arena-vs grid size-9 place-items-center rounded-full border backdrop-blur-[2px] ${energy ? "arena-vs-energy" : "shadow-[0_0_0_1px_rgba(142,123,255,0.28),0_0_12px_rgba(95,227,255,0.16)]"}`}
      aria-hidden
    >
      <span className="text-[0.56rem] font-bold tracking-[0.16em]">VS</span>
    </div>
  );
}
