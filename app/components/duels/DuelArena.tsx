"use client";

import { useState } from "react";
import { duelsApi, shareInvite, type DuelBoard } from "@/lib/duels/api";
import { describeRuleChanges } from "@/lib/duels/rules";
import { addCalendarDays } from "@/lib/duels/score";
import type { ShowcaseBattle } from "@/lib/duels/showcase";
import { consistencyStreak, dayPhase, type DayPhase } from "@/lib/duels/streak";
import { addActivity, createActivityId, toggleActivity, type TrackerState } from "@/lib/tracker";
import type { TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { BattleShowcase } from "./BattleShowcase";
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
}: {
  board: DuelBoard;
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => void;
  activeActivityId: string | null;
  unsynced: boolean;
  connectOnOpen: boolean;
  battles: ShowcaseBattle[];
  busy: boolean;
  onNote: (note: string | null) => void;
  onAct: (work: () => Promise<void>, note?: string) => Promise<void>;
  onClose: () => void;
}) {
  const todayKey = board.you.todayKey;
  const inRange = board.youDays.some((day) => day.dayKey === todayKey);
  const [selectedDay, setSelectedDay] = useState(inRange ? todayKey : (board.youDays[0]?.dayKey ?? board.duel.startsOn));
  const [connectId, setConnectId] = useState<string | "all" | null>(connectOnOpen ? "all" : null);
  const [managing, setManaging] = useState(false);
  const activities = tracker.activities.filter((activity) => activity.archivedAtMs === null);
  const mapped = new Map(board.you.mappings.map((item) => [item.challengeActivityId, item.trackerActivityId]));
  const youDay = board.youDays.find((day) => day.dayKey === selectedDay);
  const friendDay = board.friendDays.find((day) => day.dayKey === selectedDay);
  const dayNumber = board.youDays.findIndex((day) => day.dayKey === todayKey);
  const lastDay = addCalendarDays(board.duel.startsOn, board.duel.durationDays - 1);
  const youStreak = consistencyStreak(board.youDays, todayKey);
  const friendStreak = consistencyStreak(board.friendDays, todayKey);
  const lead = !board.friend ? "waiting" : board.you.score === board.friend.score ? "tie" : board.you.score > board.friend.score ? "you" : "friend";
  const unmapped = board.activities.filter((activity) => !mapped.get(activity.id));
  const battleActivities = youDay?.activities.some((item) => item.name)
    ? youDay.activities.map((item) => ({
        id: item.id,
        name: item.name ?? "Activity",
        targetMinutes: item.targetMinutes ?? board.activities.find((activity) => activity.id === item.id)?.targetMinutes ?? 20,
      }))
    : board.activities;
  const connectTargets = connectId === "all" ? unmapped : board.activities.filter((activity) => activity.id === connectId);

  const connect = (challengeActivityId: string, trackerActivityId: string) => {
    void onAct(async () => {
      const client = getSupabaseBrowserClient();
      if (!client) return;
      await duelsApi.map(client, board.duel.id, challengeActivityId, trackerActivityId);
      if (board.you.shareLive) await duelsApi.syncPresence(client, activeActivityId);
    });
  };

  const addMine = (challengeActivityId: string, name: string, targetMinutes: number) => {
    const id = createActivityId(name);
    commit((base) => addActivity(base, { id, name, iconKey: "briefcase", color: "#8E7BFF", goalMinutes: targetMinutes, cue: "Duel activity" }));
    connect(challengeActivityId, id);
  };

  return (
    <div className="mt-4">
      <section className="overflow-hidden rounded-[24px] border border-line bg-ink-1 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-1">{board.duel.title}</h2>
            <p className="text-xs text-text-3">
              {dayNumber >= 0 ? `Day ${dayNumber + 1} of ${board.duel.durationDays}` : todayKey < board.duel.startsOn ? `Starts ${board.duel.startsOn}` : "Complete"}
              {" · "}
              {board.duel.startsOn} to {lastDay}
            </p>
          </div>
          <button type="button" onClick={onClose} className="grid size-11 shrink-0 place-items-center text-xs font-medium text-text-3">Close</button>
        </div>
        {board.duel.plannedStartsOn !== board.duel.startsOn && (
          <p className="mt-2 text-xs text-text-2">Start moved from {board.duel.plannedStartsOn} to {board.duel.startsOn}. Time before {board.duel.startsOn} does not count.</p>
        )}
        {board.duel.awaitingOpponent && (
          <p className="mt-2 text-xs text-text-3">Points start once your friend accepts. Tracking before then does not count.</p>
        )}
        {unsynced && <p className="mt-2 text-xs text-ember">Scores are provisional until tracking syncs.</p>}
        {board.you.status === "left" && (
          <p className="mt-2 text-xs text-ember">You left this duel. Earlier points stay. You are not earning new points or sharing live status.</p>
        )}
        {board.friend?.status === "left" && (
          <p className="mt-2 text-xs text-ember">{board.friend.name} left this duel. Earlier points stay. They are not earning new points, and their live activity status is hidden.</p>
        )}
        {board.duel.status === "cancelled" && (
          <p className="mt-2 text-xs text-text-3">This duel was cancelled. Personal tracking was not deleted.</p>
        )}
        {unmapped.length > 0 && board.you.status === "active" && (
          <p className="mt-2 text-xs text-volt-hi">
            {unmapped.map((activity) => activity.name).join(", ")} {unmapped.length === 1 ? "is" : "are"} not connected.
            <button type="button" onClick={() => setConnectId("all")} className="ml-2 min-h-11 font-semibold">Connect</button>
          </p>
        )}

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] items-stretch gap-1">
          <PlayerPanel name={board.you.name} score={board.you.score} streak={youStreak} leading={lead === "you"} live={null} />
          <div className="flex flex-col items-center justify-center">
            <p className="text-[0.65rem] font-semibold tracking-[0.16em] text-text-3">VS</p>
            <p className={`mt-1 text-center text-[0.6rem] font-medium leading-tight ${lead === "tie" || lead === "waiting" ? "text-text-3" : lead === "you" ? "text-volt-hi" : "text-ice"}`}>
              {lead === "waiting" ? "Open" : lead === "tie" ? "Tied" : lead === "you" ? "You lead" : "They lead"}
            </p>
          </div>
          <PlayerPanel
            name={board.friend?.name ?? "Friend"}
            score={board.friend?.score ?? 0}
            streak={board.friend ? friendStreak : 0}
            leading={lead === "friend"}
            live={
              board.friend?.status === "left"
                ? "Left the duel"
                : board.presence
                  ? `${board.presence.name} is ${board.presence.activity.toLowerCase()}`
                  : board.duel.awaitingOpponent
                    ? "Invite open"
                    : null
            }
          />
        </div>
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
        {board.duel.final && (
          <p className="mt-3 text-center text-sm font-semibold text-text-1">
            {unsynced ? "The period has ended. This result isn't final until tracking syncs." : board.duel.winner === "tie" ? "It's a tie." : board.duel.winner === "you" ? "You won." : "Your friend won."}
          </p>
        )}
      </section>

      <section className="mt-4" aria-label="Activity battles">
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
              <article key={activity.id} className="rounded-[18px] border border-line bg-ink-1 px-3 py-3">
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
                  <i className={`size-1.5 rounded-full ${friend ? phaseDot(friendMark) : "bg-white/10"}`} />
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
          <div className="mt-4 space-y-4">
            {connectTargets.map((activity) => (
              <div key={activity.id}>
                <p className="text-sm font-semibold text-text-1">{activity.name}</p>
                <p className="text-xs text-text-3">{activity.targetMinutes} min / day. Pick one of your activities, or add it to Today. A matching name is not selected for you.</p>
                <ul className="mt-2">
                  {activities.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="min-h-11 w-full rounded-xl px-2 text-left text-sm text-text-1 hover:bg-white/5"
                        onClick={() => {
                          connect(activity.id, item.id);
                          setConnectId(null);
                        }}
                      >
                        Use {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-primary mt-2 h-11 w-full"
                  onClick={() => {
                    addMine(activity.id, activity.name, activity.targetMinutes);
                    setConnectId(null);
                  }}
                >
                  Add to my activities
                </button>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function PlayerPanel({ name, score, streak, leading, live }: { name: string; score: number; streak: number; leading: boolean; live: string | null }) {
  return (
    <div className={`min-w-0 rounded-[18px] border px-2 py-2 text-center ${leading ? "border-volt/40 bg-volt/[0.06]" : "border-line bg-ink-0"}`}>
      <div className="mx-auto grid size-12 place-items-center rounded-[16px] border border-white/10 bg-[linear-gradient(160deg,rgba(142,123,255,0.2),rgba(95,227,255,0.08))] text-sm font-semibold text-text-1" aria-hidden>
        {initials(name)}
      </div>
      <p className="mt-1 truncate text-xs font-semibold text-text-1">{name}</p>
      <p className="numeric text-2xl font-semibold leading-none text-text-1">{score}</p>
      <p className="mt-1 text-[0.65rem] text-text-3">{streak > 0 ? `${streak}-day streak` : "No streak yet"}</p>
      {live && <p className="mt-1 truncate text-[0.65rem] text-ice">{live}</p>}
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
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" role="meter" aria-valuenow={Math.min(minutes, target)} aria-valuemin={0} aria-valuemax={target} aria-label={`${label} ${minutes} of ${target} minutes`}>
        <div className={`h-full rounded-full motion-reduce:transition-none ${met ? "bg-mint" : tone === "volt" ? "bg-volt" : "bg-ice"} transition-[width] duration-300`} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-[0.65rem] text-text-3">{minutes}/{target} min</p>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const mark = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return mark || "•";
}

function phaseTile(phase: DayPhase): string {
  if (phase === "current") return "bg-ice/10 text-text-1";
  if (phase === "completed") return "bg-volt/20 text-text-1";
  if (phase === "partial") return "bg-white/10 text-text-2";
  if (phase === "missed") return "bg-white/5 text-text-3";
  return "bg-transparent text-text-3";
}

function phaseDot(phase: DayPhase): string {
  if (phase === "completed") return "bg-mint";
  if (phase === "partial") return "bg-volt";
  if (phase === "current") return "bg-ice";
  if (phase === "missed") return "bg-white/25";
  return "bg-white/15";
}
