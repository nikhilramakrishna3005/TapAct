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
    <div className="relative mt-3 overflow-hidden rounded-[22px] border border-white/[0.06]" role="region" aria-label="Character versus arena">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_8%_10%,rgba(142,123,255,0.2),transparent_52%),radial-gradient(90%_80%_at_92%_10%,rgba(95,227,255,0.16),transparent_52%),linear-gradient(180deg,#12121a,#0a0a10_70%)]"
      />
      <div className="relative grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-stretch">
        <PlayerStage
          name={youName}
          character={youCharacter}
          score={youScore}
          streak={youStreak}
          side="you"
          leading={reactions.youLead}
          live={reactions.youLive}
          achieved={reactions.youAchieved}
          winner={victory?.kind === "you"}
          liveLabel={null}
        />
        <VsEmblem lead={lead} energy={reactions.vsEnergy} />
        <PlayerStage
          name={friendName}
          character={friendCharacter}
          score={friendScore ?? 0}
          streak={friendStreak}
          side="friend"
          leading={reactions.friendLead}
          live={reactions.friendLive}
          achieved={reactions.friendAchieved}
          winner={victory?.kind === "friend"}
          liveLabel={liveLabel}
        />
      </div>

      <div className="relative px-3 pb-3">
        <p className="sr-only">
          {momentum.awaiting
            ? `Your score is ${youScore}. Your friend has not joined.`
            : `Score comparison ${youScore} to ${friendScore ?? 0}. ${leadCopy(lead)}.`}
        </p>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            className="h-full bg-volt transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${momentum.youPercent}%` }}
          />
          <div
            className="h-full bg-ice transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${momentum.friendPercent}%` }}
          />
        </div>
        <p className="mt-1.5 text-center text-[0.65rem] text-text-3">
          {momentum.awaiting
            ? `${youScore} pts · waiting for your friend`
            : `${youScore}–${friendScore} · ${leadCopy(lead).toLowerCase()}`}
        </p>
      </div>

      {victory && (
        <div
          className={`relative mx-3 mb-3 flex items-center gap-2 rounded-[16px] border px-2.5 py-2 ${
            victory.kind === "tie" || victory.kind === "provisional"
              ? "border-white/10 bg-ink-0/70"
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
            <p className="text-[0.7rem] leading-snug text-text-3">{victory.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerStage({
  name,
  character,
  score,
  streak,
  side,
  leading,
  live,
  achieved,
  winner,
  liveLabel,
}: {
  name: string;
  character: DuelCharacterPublic | null;
  score: number;
  streak: number;
  side: "you" | "friend";
  leading: boolean;
  live: boolean;
  achieved: boolean;
  winner: boolean;
  liveLabel: string | null;
}) {
  const accent = accentOf(character?.accent)?.hex ?? (side === "you" ? "#8E7BFF" : "#5FE3FF");
  return (
    <div
      className={`relative min-w-0 px-1.5 pb-2 pt-1.5 text-center ${
        winner ? "bg-white/[0.03]" : leading ? "bg-white/[0.02]" : ""
      }`}
    >
      {live && (
        <div
          aria-hidden
          className="arena-live-glow pointer-events-none absolute inset-1 rounded-[18px]"
          style={{ boxShadow: `inset 0 0 22px ${accent}55` }}
        />
      )}
      <div
        className="relative overflow-hidden rounded-[18px]"
        style={{
          boxShadow: leading || winner
            ? `0 0 0 1px ${accent}66, 0 10px 24px -16px ${accent}`
            : "0 0 0 1px rgba(255,255,255,0.06)",
        }}
      >
        <CharacterPortrait character={character} name={name} variant="stage" />
        {achieved && (
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-mint shadow-[0_0_8px_rgba(108,242,194,0.7)]" aria-hidden />
        )}
      </div>
      <p className="relative mt-1.5 truncate px-0.5 text-xs font-semibold text-text-1">{name}</p>
      <p className="relative truncate px-0.5 text-[0.62rem] text-text-3">{character?.title ?? (side === "friend" ? "Awaiting character" : "Ready to appear")}</p>
      <p className="relative numeric mt-0.5 text-[1.65rem] font-semibold leading-none text-text-1">{score}</p>
      <p className="relative mt-1 text-[0.62rem] text-text-3">{streak > 0 ? `${streak}-day streak` : "No streak yet"}</p>
      {liveLabel && <p className="relative mt-1 truncate px-0.5 text-[0.62rem] text-ice">{liveLabel}</p>}
    </div>
  );
}

function VsEmblem({ lead, energy }: { lead: ReturnType<typeof arenaLead>; energy: boolean }) {
  const tone = lead === "you" ? "text-volt-hi" : lead === "friend" ? "text-ice" : "text-text-3";
  return (
    <div className="relative flex flex-col items-center justify-center self-center">
      <div
        className={`grid size-10 place-items-center rounded-full border border-white/15 bg-[#0c0c12] ${energy ? "arena-vs-energy" : ""}`}
        aria-hidden
      >
        <span className="text-[0.58rem] font-bold tracking-[0.16em] text-text-1">VS</span>
      </div>
      <p className={`mt-1 text-center text-[0.58rem] font-medium leading-tight ${tone}`}>{leadCopy(lead)}</p>
    </div>
  );
}
