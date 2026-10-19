"use client";

import { useEffect, useRef, useState } from "react";
import { duelsApi, shareInvite, type DuelBoard } from "@/lib/duels/api";
import { compactDuelStatus } from "@/lib/duels/arena";
import {
  activeNameMatches,
  claimLinkAttempt,
  planJoinLink,
  trackerUsedByOtherChallenge,
} from "@/lib/duels/connect";
import { describeRuleChanges } from "@/lib/duels/rules";
import { addCalendarDays } from "@/lib/duels/score";
import type { ShowcaseBattle } from "@/lib/duels/showcase";
import { consistencyStreak, dayPhase, type DayPhase } from "@/lib/duels/streak";
import { toggleActivity, type TrackerState } from "@/lib/tracker";
import type { CommitResult, TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { archetypeOf } from "@/lib/duels/character";
import { completedRecapDays, recapHighlight, recapSeenKey } from "@/lib/duels/recap";
import { ArenaVersus } from "./ArenaVersus";
import { DailyRecap } from "./DailyRecap";
import { BattleShowcase } from "./BattleShowcase";
import { CharacterPortrait } from "./CharacterPortrait";
import { ManageActivitiesSheet, ProposalCard } from "./ManageActivitiesSheet";
import { Sheet } from "../ui";

const RULES = [
  "20 points for each daily target you meet.",
  "10 bonus points when every target is met that day.",
  "Time past a target does not add points.",
  "Only timer-recorded time counts. Sessions added or edited by hand stay in History and do not score.",
  "Days use the time zone saved when you join.",
  "Nothing before the official start date counts.",
];

export function DuelArena({
  board,
  tracker,
  commit,
  activeActivityId,
  unsynced,
  connectOnOpen,
  battles,
  busy,
  onNote,
  onAct,
  onClose,
  onChangeCharacter,
  onCustomizeCharacter,
}: {
  board: DuelBoard;
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => CommitResult | void;
  activeActivityId: string | null;
  unsynced: boolean;
  connectOnOpen: boolean;
  battles: ShowcaseBattle[];
  busy: boolean;
  onNote: (note: string | null) => void;
  onAct: (work: () => Promise<void>, note?: string) => Promise<void>;
  onClose: () => void;
  onChangeCharacter: () => void;
  onCustomizeCharacter: () => void;
}) {
  const todayKey = board.you.todayKey;
  const inRange = board.youDays.some((day) => day.dayKey === todayKey);
  const [selectedDay, setSelectedDay] = useState(inRange ? todayKey : (board.youDays[0]?.dayKey ?? board.duel.startsOn));
  const [connectId, setConnectId] = useState<string | "all" | null>(connectOnOpen ? "all" : null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [seenRecap, setSeenRecap] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [connectNote, setConnectNote] = useState<string | null>(null);
  const linking = useRef(false);
  const activities = tracker.activities.filter((activity) => activity.archivedAtMs === null);
  const mapped = new Map(board.you.mappings.map((item) => [item.challengeActivityId, item.trackerActivityId]));
  const youDay = board.youDays.find((day) => day.dayKey === selectedDay);
  const friendDay = board.friendDays.find((day) => day.dayKey === selectedDay);
  const youToday = board.youDays.find((day) => day.dayKey === todayKey);
  const friendToday = board.friendDays.find((day) => day.dayKey === todayKey);
  const dayNumber = board.youDays.findIndex((day) => day.dayKey === todayKey);
  const lastDay = addCalendarDays(board.duel.startsOn, board.duel.durationDays - 1);
  const youStreak = consistencyStreak(board.youDays, todayKey);
  const friendStreak = consistencyStreak(board.friendDays, todayKey);
  const unmapped = board.activities.filter((activity) => !mapped.get(activity.id));
  const battleActivities = youDay?.activities.some((item) => item.name)
    ? youDay.activities.map((item) => ({
        id: item.id,
        name: item.name ?? "Activity",
        targetMinutes: item.targetMinutes ?? board.activities.find((activity) => activity.id === item.id)?.targetMinutes ?? 20,
      }))
    : board.activities;
  const connectTargets = connectId === "all" ? unmapped : board.activities.filter((activity) => activity.id === connectId);
  const joinPlan = planJoinLink(tracker.activities);

  const finishLink = () => {
    linking.current = false;
  };

  const mapTracker = (challengeActivityId: string, trackerActivityId: string) => {
    const current = mapped.get(challengeActivityId) ?? null;
    const already = current === trackerActivityId && activities.some((item) => item.id === current);
    if (already) {
      finishLink();
      setConnectNote("Already connected. Your Today activity was left as it is.");
      return;
    }
    let started = false;
    void onAct(async () => {
      started = true;
      try {
        const client = getSupabaseBrowserClient();
        if (!client) throw new Error("Sign in to connect this activity.");
        await duelsApi.map(client, board.duel.id, challengeActivityId, trackerActivityId);
        if (board.you.shareLive) await duelsApi.syncPresence(client, activeActivityId);
        setConnectNote(null);
        setConnectId(null);
      } finally {
        finishLink();
      }
    });
    queueMicrotask(() => {
      if (!started) finishLink();
    });
  };

  const linkExisting = (challengeActivityId: string, trackerActivityId: string) => {
    if (!claimLinkAttempt(linking)) return;
    if (trackerUsedByOtherChallenge(board.you.mappings, challengeActivityId, trackerActivityId)) {
      finishLink();
      setConnectNote("That Today activity is already linked in this duel. Its tracking still counts once.");
      return;
    }
    setConnectNote(null);
    mapTracker(challengeActivityId, trackerActivityId);
  };

  const recapZones = [board.you.timeZone, board.friend?.timeZone].filter((zone): zone is string => Boolean(zone));
  const newestRecap = completedRecapDays(board.youDays.map((day) => day.dayKey), recapZones, Date.now()).at(-1) ?? null;
  useEffect(() => {
    try {
      setSeenRecap(window.localStorage.getItem(recapSeenKey(board.duel.id)));
    } catch {
      setSeenRecap(null);
    }
  }, [board.duel.id]);
  const recapFresh = recapHighlight(seenRecap, newestRecap);

  const status = compactDuelStatus({
    todayKey,
    startsOn: board.duel.startsOn,
    durationDays: board.duel.durationDays,
    dayIndex: dayNumber,
    completed: board.duel.final || board.duel.status === "completed",
  });

  return (
    <div className="mt-2">
      <section className="rounded-[22px] border border-line bg-ink-1 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-1">{board.duel.title}</h2>
            <p className="text-[0.7rem] text-text-3">{status}</p>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => {
                setRecapOpen(true);
                if (!newestRecap) return;
                try {
                  window.localStorage.setItem(recapSeenKey(board.duel.id), newestRecap);
                } catch {
                  // The highlight can return next visit if storage is blocked.
                }
                setSeenRecap(newestRecap);
              }}
              className="relative min-h-11 px-2 text-xs font-semibold text-ice"
            >
              Recap
              {recapFresh && <span className="absolute right-1 top-2 size-1.5 rounded-full bg-ice" aria-hidden />}
            </button>
            <details className="relative">
              <summary className="grid size-11 cursor-pointer list-none place-items-center text-xs font-semibold text-text-3 [&::-webkit-details-marker]:hidden" aria-label="Duel details">
                Info
              </summary>
              <div className="absolute right-0 top-full z-20 w-[16.5rem] rounded-2xl border border-line bg-ink-1 px-3 py-2.5 text-xs leading-relaxed text-text-3 shadow-[0_16px_40px_-24px_var(--shadow)]">
                <p className="font-medium text-text-2">{board.duel.startsOn} to {lastDay}</p>
                {board.duel.plannedStartsOn !== board.duel.startsOn && (
                  <p className="mt-1.5">Start moved from {board.duel.plannedStartsOn} to {board.duel.startsOn}. Time before {board.duel.startsOn} does not count.</p>
                )}
                {board.duel.awaitingOpponent && (
                  <p className="mt-1.5">Points start once your friend accepts. Tracking before then does not count.</p>
                )}
                {board.duel.plannedStartsOn === board.duel.startsOn && !board.duel.awaitingOpponent && (
                  <p className="mt-1.5">Official start {board.duel.startsOn}. Days use the time zone saved when you joined.</p>
                )}
              </div>
            </details>
            <button type="button" onClick={onClose} className="grid size-11 place-items-center text-xs font-medium text-text-3">Close</button>
          </div>
        </div>
        {unsynced && <p className="mt-1.5 text-xs text-ember">Scores are provisional until tracking syncs.</p>}
        {board.you.status === "left" && (
          <p className="mt-1.5 text-xs text-ember">You left this duel. Earlier points stay. You are not earning new points or sharing live status.</p>
        )}
        {board.friend?.status === "left" && (
          <p className="mt-1.5 text-xs text-ember">{board.friend.name} left this duel. Earlier points stay. They are not earning new points, and their live activity status is hidden.</p>
        )}
        {board.duel.status === "cancelled" && (
          <p className="mt-1.5 text-xs text-text-3">This duel was cancelled. Personal tracking was not deleted.</p>
        )}
        {unmapped.length > 0 && board.you.status === "active" && (
          <p className="mt-1.5 text-xs text-volt-hi">
            {unmapped.map((activity) => activity.name).join(", ")} {unmapped.length === 1 ? "is" : "are"} not connected.
            <button type="button" onClick={() => setConnectId("all")} className="ml-2 min-h-11 font-semibold">Connect</button>
          </p>
        )}

        <ArenaVersus
          youName={board.you.name}
          friendName={board.friend?.name ?? "Friend"}
          youScore={board.you.score}
          friendScore={board.friend ? board.friend.score : null}
          youStreak={youStreak}
          friendStreak={board.friend ? friendStreak : 0}
          youCharacter={board.you.character}
          friendCharacter={board.friend?.character ?? null}
          youStatus={board.you.status}
          friendStatus={board.friend?.status ?? null}
          youToday={youToday}
          friendToday={friendToday}
          mappings={board.you.mappings}
          activeActivityId={activeActivityId}
          presence={board.presence}
          final={board.duel.final}
          winner={board.duel.winner}
          unsynced={unsynced}
          awaitingOpponent={board.duel.awaitingOpponent}
        />
        {board.presence && board.friend?.status !== "left" && activities.some((item) => item.id === mapped.get(board.presence?.activityId ?? "")) && (
          <button
            type="button"
            className="mt-2 min-h-11 w-full text-xs font-semibold text-ice"
            onClick={() => {
              const id = mapped.get(board.presence?.activityId ?? "");
              if (id) commit((base) => toggleActivity(base, id, Date.now()));
            }}
          >
            Start mine
          </button>
        )}
      </section>

      <section className="mt-2.5" aria-label="Activity battles">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">Activity battles</h3>
          {board.you.status === "active" && (board.duel.awaitingOpponent || (!board.duel.final && board.duel.status === "active")) && (
            <button type="button" onClick={() => setManaging(true)} className="min-h-11 shrink-0 text-xs font-semibold text-volt-hi">
              Manage activities
            </button>
          )}
        </div>
        {board.rulesEffectiveOn && board.rulesEffectiveOn > todayKey && (
          <p className="mt-2 text-xs text-text-3">Agreed rules change on {board.rulesEffectiveOn}. This day still uses the targets in force on {selectedDay}.</p>
        )}
        {board.proposal && (
          <ProposalCard
            board={board}
            changes={describeRuleChanges(board.activities, board.proposal.activities)}
            busy={busy}
            onAct={onAct}
          />
        )}
        <div className="mt-2 space-y-2">
          {battleActivities.map((activity) => {
            const yours = youDay?.activities.find((item) => item.id === activity.id);
            const theirs = friendDay?.activities.find((item) => item.id === activity.id);
            const trackerId = mapped.get(activity.id) ?? null;
            const personal = activities.find((item) => item.id === trackerId);
            const tracking = trackerId !== null && trackerId === activeActivityId;
            const canStart = selectedDay === todayKey && board.you.status === "active" && personal;
            const liveActivity = board.activities.some((item) => item.id === activity.id);
            return (
              <article key={activity.id} className="rounded-[18px] border border-line bg-[linear-gradient(180deg,rgba(142,123,255,0.05),transparent_42%),var(--ink-1)] px-3 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-sm font-semibold text-text-1">{activity.name}</h4>
                  <p className="text-xs text-text-3">{activity.targetMinutes} min / day</p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <BattleBar label="You" minutes={yours?.minutes ?? 0} target={activity.targetMinutes} met={yours?.met ?? false} dayKey={selectedDay} todayKey={todayKey} tone="volt" />
                  <BattleBar label={board.friend?.name ?? "Friend"} minutes={theirs?.minutes ?? 0} target={activity.targetMinutes} met={theirs?.met ?? false} dayKey={selectedDay} todayKey={todayKey} tone="ice" />
                </div>
                <div className="mt-2 flex items-center justify-end gap-2">
                  {canStart ? (
                    <button type="button" onClick={() => commit((base) => toggleActivity(base, personal.id, Date.now()))} className="min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold text-ice">
                      {tracking ? "Pause" : "Start"}
                    </button>
                  ) : !trackerId && board.you.status === "active" && liveActivity ? (
                    <button type="button" onClick={() => setConnectId(activity.id)} className="min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold text-volt-hi">
                      Connect activity
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-2 text-[0.7rem] text-text-3">Extra time past a target fills the bar and does not add points.</p>
      </section>

      <section className="mt-4" aria-label="Battle progress">
        <h3 className="eyebrow">Battle progress</h3>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {board.youDays.map((day, index) => {
            const friend = board.friendDays.find((item) => item.dayKey === day.dayKey);
            const youPhase = dayPhase(day.dayKey, todayKey, day.bonus, day.activities.some((item) => item.met));
            const friendPhase = friend ? dayPhase(day.dayKey, todayKey, friend.bonus, friend.activities.some((item) => item.met)) : "future";
            const youMark = day.bonus ? "completed" : youPhase;
            const friendMark = friend?.bonus ? "completed" : friendPhase;
            return (
              <button
                key={day.dayKey}
                type="button"
                aria-pressed={selectedDay === day.dayKey}
                onClick={() => setSelectedDay(day.dayKey)}
                className={`min-h-11 rounded-lg border px-0.5 py-1 ${selectedDay === day.dayKey ? "border-volt/70" : "border-transparent"} ${phaseTile(youPhase)}`}
              >
                <span className="block text-[0.65rem] font-semibold">{index + 1}</span>
                <span className="mt-0.5 flex justify-center gap-0.5" aria-hidden>
                  <i className={`size-1.5 rounded-full ${phaseDot(youMark)}`} />
                  <i className={`size-1.5 rounded-full ${friend ? phaseDot(friendMark) : "bg-[var(--track)]"}`} />
                </span>
                <span className="sr-only">{day.dayKey}. You {day.points} points. {friend ? `Friend ${friend.points} points.` : "Friend has not joined."}</span>
              </button>
            );
          })}
        </div>
        {youDay && (
          <div className="mt-2 rounded-[16px] border border-line px-3 py-2 text-xs text-text-2">
            <p className="font-medium text-text-1">{selectedDay}{selectedDay === todayKey ? " · today" : ""}</p>
            <p className="mt-1">You {youDay.points} pts{youDay.bonus ? " · every target met" : ""}{friendDay ? ` · ${board.friend?.name ?? "Friend"} ${friendDay.points} pts` : ""}</p>
          </div>
        )}
      </section>

      <BattleShowcase battles={battles} />

      <details className="mt-4 rounded-[18px] border border-line bg-ink-1 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-text-1">Duel settings</summary>
        <div className="space-y-3 pb-2 text-sm text-text-2">
          <div>
            <p className="eyebrow">Your character</p>
            <div className="mt-2 flex items-center gap-3">
              <CharacterPortrait character={board.you.character} name={board.you.name} size="md" className="mx-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-1">{board.you.character?.title ?? "No character yet"}</p>
                <p className="truncate text-xs text-text-3">
                  {board.you.character ? `${archetypeOf(board.you.character.archetype)?.name ?? "Character"} · cosmetic only` : "Choose a character to show in the arena."}
                </p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={onChangeCharacter} className="min-h-11 text-xs font-semibold text-volt-hi">
                Change character
              </button>
              <button type="button" onClick={onCustomizeCharacter} className="min-h-11 text-xs font-semibold text-volt-hi">
                Customize
              </button>
            </div>
          </div>
          <div>
            <p className="eyebrow">Activity connections</p>
            <ul className="mt-2 space-y-2">
              {board.activities.map((activity) => {
                const personal = activities.find((item) => item.id === mapped.get(activity.id));
                return (
                  <li key={activity.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-text-1">{activity.name}</span>
                      <span className="block truncate text-xs text-text-3">{personal ? personal.name : "Not connected"}</span>
                    </span>
                    {board.you.status === "active" && (
                      <button type="button" onClick={() => setConnectId(activity.id)} className="min-h-11 shrink-0 text-xs font-semibold text-volt-hi">
                        {personal ? "Change" : "Connect"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span>Share when I'm tracking a duel activity</span>
            <input
              type="checkbox"
              disabled={board.you.status !== "active"}
              checked={board.you.shareLive}
              onChange={(event) => {
                const share = event.target.checked;
                void onAct(async () => {
                  const client = getSupabaseBrowserClient();
                  if (!client) return;
                  await duelsApi.prefs(client, board.duel.id, share, board.you.muted);
                  if (share) await duelsApi.syncPresence(client, activeActivityId);
                });
              }}
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span>Mute their live status</span>
            <input
              type="checkbox"
              disabled={board.you.status !== "active"}
              checked={board.you.muted}
              onChange={(event) => {
                const muted = event.target.checked;
                void onAct(async () => {
                  const client = getSupabaseBrowserClient();
                  if (!client) return;
                  await duelsApi.prefs(client, board.duel.id, board.you.shareLive, muted);
                });
              }}
            />
          </label>
          <details>
            <summary className="min-h-11 cursor-pointer py-2">Challenge rules</summary>
            <ul className="space-y-1 pb-2 text-xs leading-relaxed text-text-3">
              {RULES.map((rule) => <li key={rule}>{rule}</li>)}
              {board.activities.map((activity) => <li key={activity.id}>{activity.name}: {activity.targetMinutes} min / day</li>)}
            </ul>
          </details>
          {board.duel.awaitingOpponent && (
            <button
              type="button"
              disabled={busy}
              className="btn btn-ghost h-11 w-full"
              onClick={() => {
                void onAct(async () => {
                  const client = getSupabaseBrowserClient();
                  if (!client) return;
                  const issued = await duelsApi.reissue(client, board.duel.id);
                  const result = await shareInvite(issued.token, board.duel.title);
                  onNote(result === "copied" ? "New invite link copied." : "New invite shared.");
                });
              }}
            >
              New invite link
            </button>
          )}
        </div>
      </details>

      {managing && (
        <ManageActivitiesSheet
          board={board}
          tracker={tracker}
          commit={commit}
          busy={busy}
          onAct={onAct}
          onClose={() => setManaging(false)}
        />
      )}

      {connectTargets.length > 0 && connectId && (
        <Sheet label="Connect activity" onClose={() => setConnectId(null)}>
          {joinPlan.kind === "empty" ? (
            <p className="mt-4 text-sm leading-relaxed text-text-2">{joinPlan.message}</p>
          ) : (
          <div className="mt-4 space-y-4">
            {connectTargets.map((activity) => {
              const connected = activities.find((item) => item.id === mapped.get(activity.id)) ?? null;
              const matches = activeNameMatches(activities, activity.name);
              const others = activities.filter(
                (item) => item.id !== connected?.id && !matches.some((match) => match.id === item.id),
              );
              const choices = matches.filter((item) => item.id !== connected?.id);
              return (
              <div key={activity.id}>
                <p className="text-sm font-semibold text-text-1">{activity.name}</p>
                <p className="text-xs text-text-3">{activity.targetMinutes} min / day in this duel. A personal goal stays on the Today activity.</p>
                {connected ? (
                  <p className="mt-2 text-xs text-text-2">Connected to {connected.name}. Its name, icon, color, and personal goal stay as they are.</p>
                ) : choices.length > 1 ? (
                  <p className="mt-2 text-xs text-text-2">More than one Today activity uses this name. Choose which one to use.</p>
                ) : choices.length === 1 ? (
                  <p className="mt-2 text-xs text-text-2">Today already has {choices[0].name}. Use it instead of creating another.</p>
                ) : (
                  <p className="mt-2 text-xs text-text-3">No Today activity uses this name.</p>
                )}
                {(choices.length > 1 || (connected && choices.length > 0)) && (
                  <ul className="mt-2">
                    {choices.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={busy}
                          className="min-h-11 w-full rounded-xl px-2 text-left text-sm text-text-1 hover:bg-[var(--wash-strong)] disabled:opacity-50"
                          onClick={() => linkExisting(activity.id, item.id)}
                        >
                          Use existing activity · {item.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {others.length > 0 && (
                  <>
                    <p className="mt-3 text-xs text-text-3">{choices.length === 0 && !connected ? "Choose a Today activity." : "Or choose a different Today activity."}</p>
                    <ul>
                      {others.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-11 w-full rounded-xl px-2 text-left text-sm text-text-1 hover:bg-[var(--wash-strong)] disabled:opacity-50"
                            onClick={() => linkExisting(activity.id, item.id)}
                          >
                            Use {item.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!connected && choices.length === 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    className="btn btn-primary mt-2 h-11 w-full"
                    onClick={() => linkExisting(activity.id, choices[0].id)}
                  >
                    Use existing activity
                  </button>
                )}
              </div>
              );
            })}
            {connectNote && <p role="status" className="text-xs text-text-2">{connectNote}</p>}
          </div>
          )}
        </Sheet>
      )}
      {recapOpen && <DailyRecap board={board} onClose={() => setRecapOpen(false)} />}
    </div>
  );
}

function BattleBar({
  label,
  minutes,
  target,
  met,
  dayKey,
  todayKey,
  tone,
}: {
  label: string;
  minutes: number;
  target: number;
  met: boolean;
  dayKey: string;
  todayKey: string;
  tone: "volt" | "ice";
}) {
  const width = Math.min(100, Math.round((minutes / Math.max(target, 1)) * 100));
  const status = dayKey > todayKey ? "Upcoming" : met ? "Done" : dayKey === todayKey ? "In progress" : "Missed";
  return (
    <div>
      <div className="flex justify-between gap-1 text-[0.65rem] text-text-3">
        <span className="truncate">{label}</span>
        <span>{status}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--track)]" role="meter" aria-valuenow={Math.min(minutes, target)} aria-valuemin={0} aria-valuemax={target} aria-label={`${label} ${minutes} of ${target} minutes`}>
        <div className={`h-full rounded-full motion-reduce:transition-none ${met ? "bg-mint" : tone === "volt" ? "bg-volt" : "bg-ice"} transition-[width] duration-300`} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-[0.65rem] text-text-3">{minutes}/{target} min</p>
    </div>
  );
}

function phaseTile(phase: DayPhase): string {
  if (phase === "current") return "bg-ice/10 text-text-1";
  if (phase === "completed") return "bg-volt/20 text-text-1";
  if (phase === "partial") return "bg-[var(--track)] text-text-2";
  if (phase === "missed") return "bg-[var(--wash-strong)] text-text-3";
  return "bg-transparent text-text-3";
}

function phaseDot(phase: DayPhase): string {
  if (phase === "completed") return "bg-mint";
  if (phase === "partial") return "bg-volt";
  if (phase === "current") return "bg-ice";
  if (phase === "missed") return "bg-[var(--handle)]";
  return "bg-[var(--track)]";
}
