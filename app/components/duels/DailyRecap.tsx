"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { DuelBoard } from "@/lib/duels/api";
import type { DuelCharacterPublic } from "@/lib/duels/character";
import { PERFECT_DAY_POINTS } from "@/lib/duels/score";
import {
  buildRecapDay,
  completedRecapDays,
  leadChangeLabel,
  liveRecapDay,
  progressPercent,
  recapAvailability,
  recapDateLabel,
  recapMotion,
  recapSeenKey,
  type RecapActivity,
  type RecapDay,
} from "@/lib/duels/recap";
import { useMotionPrefs } from "../MotionPrefs";
import { Sheet } from "../ui";
import { CharacterPortrait } from "./CharacterPortrait";

const EMPTY: Record<string, string> = {
  pending: "No daily recap yet. Recaps start after your friend joins and a full competition day ends in both saved time zones.",
  cancelled: "This duel was cancelled, so there isn’t a completed recap.",
  "needs-zones": "Recaps need both saved time zones from the latest duel update.",
  empty: "No completed day yet. A recap appears after the day ends in both saved time zones.",
};

function Meter({ label, minutes, target, met, tone }: { label: string; minutes: number; target: number; met: boolean; tone: "you" | "friend" }) {
  const width = progressPercent(minutes, target);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[0.72rem]">
        <span className="truncate text-text-2">{label}</span>
        <span className="shrink-0 tabular-nums text-text-3">{minutes}/{target} min · {met ? "Goal met" : "Short of target"}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className={`h-full rounded-full ${tone === "you" ? "bg-ice" : "bg-volt"}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ActivityRow({ activity, youName, friendName }: { activity: RecapActivity; youName: string; friendName: string }) {
  return (
    <li className="rounded-2xl border border-line bg-ink-0/40 px-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-semibold text-text-1">{activity.name}</p>
        <p className="shrink-0 text-[0.72rem] text-text-3">{activity.targetMinutes} min target</p>
      </div>
      <div className="mt-2 space-y-2">
        <Meter label={youName} minutes={activity.youMinutes} target={activity.targetMinutes} met={activity.youMet} tone="you" />
        <Meter label={friendName} minutes={activity.friendMinutes} target={activity.targetMinutes} met={activity.friendMet} tone="friend" />
      </div>
      <p className="mt-2 text-[0.72rem] tabular-nums text-text-3">
        {youName} {activity.youPoints} · {friendName} {activity.friendPoints}
      </p>
    </li>
  );
}

function RecapBody({
  recap,
  youName,
  friendName,
  youCharacter,
  friendCharacter,
  live,
}: {
  recap: RecapDay;
  youName: string;
  friendName: string;
  youCharacter: DuelCharacterPublic | null;
  friendCharacter: DuelCharacterPublic | null;
  live: boolean;
}) {
  return (
    <div>
      {live && (
        <p className="rounded-2xl border border-dashed border-ice/50 bg-ice/10 px-3 py-2 text-xs font-semibold text-ice">
          Live — not a final recap. This day has not ended in both time zones.
        </p>
      )}
      <p className={`${live ? "mt-3" : ""} text-[1.35rem] font-semibold tracking-[-0.03em] text-text-1`}>{recap.headline}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <article className="rounded-2xl border border-line bg-ink-0/50 px-3 py-3">
          <CharacterPortrait character={youCharacter} name={youName} size="md" />
          <p className="mt-2 truncate text-sm font-semibold text-text-1">{youName}</p>
          <p className="mt-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ice">Today</p>
          <p className="text-3xl font-semibold tabular-nums text-text-1">{recap.youDaily}</p>
          <p className="mt-1 text-[0.72rem] tabular-nums text-text-3">Total {recap.youCumulative}</p>
        </article>
        <article className="rounded-2xl border border-line bg-ink-0/50 px-3 py-3">
          <CharacterPortrait character={friendCharacter} name={friendName} size="md" />
          <p className="mt-2 truncate text-sm font-semibold text-text-1">{friendName}</p>
          <p className="mt-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-volt-hi">Today</p>
          <p className="text-3xl font-semibold tabular-nums text-text-1">{recap.friendDaily}</p>
          <p className="mt-1 text-[0.72rem] tabular-nums text-text-3">Total {recap.friendCumulative}</p>
        </article>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-2">{recap.summary}</p>
      {recap.final && <p className="mt-2 text-xs font-semibold text-text-1">{leadChangeLabel(recap.leadChange)}</p>}
      {(recap.youBonus || recap.friendBonus) && (
        <p className="mt-2 text-xs text-ice">
          {recap.youBonus ? `Perfect-day bonus +${PERFECT_DAY_POINTS}` : `${friendName} earned the perfect-day bonus.`}
          {recap.youBonus && recap.friendBonus ? ` · ${friendName} too` : ""}
        </p>
      )}
      <ul className="mt-4 space-y-2" aria-label="Activity progress">
        {recap.activities.length === 0 ? (
          <li className="text-xs text-text-3">No shared activities were scored this day.</li>
        ) : (
          recap.activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} youName={youName} friendName={friendName} />
          ))
        )}
      </ul>
    </div>
  );
}

export function DailyRecap({ board, onClose }: { board: DuelBoard; onClose: () => void }) {
  const motionPrefs = useMotionPrefs();
  const zones = [board.you.timeZone, board.friend?.timeZone].filter((zone): zone is string => Boolean(zone));
  const dayKeys = board.youDays.map((day) => day.dayKey);
  const [now] = useState(() => Date.now());
  const completed = completedRecapDays(dayKeys, zones, now);
  const liveKey = liveRecapDay(dayKeys, zones, now);
  const newest = completed.at(-1) ?? null;
  const availability = recapAvailability({
    status: board.duel.status,
    hasFriend: Boolean(board.friend),
    youZone: board.you.timeZone,
    friendZone: board.friend?.timeZone,
    completedCount: completed.length,
  });
  const [index, setIndex] = useState(Math.max(0, completed.length - 1));
  const selectedKey = completed[index] ?? completed.at(-1);
  const youName = board.you.name || "You";
  const friendName = board.friend?.name || "Friend";

  useEffect(() => {
    if (!newest) return;
    try {
      window.localStorage.setItem(recapSeenKey(board.duel.id), newest);
    } catch {
      // Private browsing can block storage. The recap still opens.
    }
  }, [board.duel.id, newest]);

  const recap = selectedKey
    ? buildRecapDay({
        dayKey: selectedKey,
        dayNumber: dayKeys.indexOf(selectedKey) + 1,
        durationDays: board.duel.durationDays,
        final: true,
        youName,
        friendName,
        youDays: board.youDays,
        friendDays: board.friendDays,
      })
    : null;
  const live = liveKey
    ? buildRecapDay({
        dayKey: liveKey,
        dayNumber: dayKeys.indexOf(liveKey) + 1,
        durationDays: board.duel.durationDays,
        final: false,
        youName,
        friendName,
        youDays: board.youDays,
        friendDays: board.friendDays,
      })
    : null;
  const enter = recapMotion(motionPrefs.reduced);

  return (
    <Sheet label="Daily recap" onClose={onClose}>
      <p className="mt-1 text-sm text-text-2">{board.duel.title}</p>
      {board.friend?.status === "left" && (
        <p className="mt-2 text-xs text-text-3">{friendName} left. Earlier points stay, and later days do not add new points for them.</p>
      )}
      {availability !== "ready" && <p className="mt-4 text-sm leading-relaxed text-text-2">{EMPTY[availability]}</p>}
      {availability === "ready" && recap && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-text-2 disabled:opacity-30" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} aria-label="Previous completed day">
              Previous
            </button>
            <div className="min-w-0 text-center">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-volt-hi">Day {recap.dayNumber} of {recap.durationDays}</p>
              <p className="truncate text-xs text-text-3">{recapDateLabel(recap.dayKey)}</p>
            </div>
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-text-2 disabled:opacity-30" disabled={index >= completed.length - 1} onClick={() => setIndex((value) => Math.min(completed.length - 1, value + 1))} aria-label="Next completed day">
              Next
            </button>
          </div>
          <motion.div key={recap.dayKey} initial={motionPrefs.reduced ? false : { opacity: 0.72 }} animate={{ opacity: 1 }} transition={enter} className="mt-3">
            <RecapBody
              recap={recap}
              youName={youName}
              friendName={friendName}
              youCharacter={board.you.character}
              friendCharacter={board.friend?.character ?? null}
              live={false}
            />
          </motion.div>
        </div>
      )}
      {live && availability !== "cancelled" && availability !== "pending" && (
        <section className="mt-6 border-t border-line pt-4" aria-label="Live day">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ice">Day {live.dayNumber} of {live.durationDays} · {recapDateLabel(live.dayKey)}</p>
          <div className="mt-3">
            <RecapBody
              recap={live}
              youName={youName}
              friendName={friendName}
              youCharacter={board.you.character}
              friendCharacter={board.friend?.character ?? null}
              live
            />
          </div>
        </section>
      )}
    </Sheet>
  );
}
