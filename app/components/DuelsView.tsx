"use client";

import { Swords } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { duelError, duelsApi, shareInvite, type DuelBoard, type DuelListItem } from "@/lib/duels/api";
import { addActivity, createActivityId, toggleActivity, type TrackerState } from "@/lib/tracker";
import type { TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { useCloudSync } from "./CloudSync";
import { CreateDuelSheet } from "./duels/CreateDuelSheet";
import { EmptyState, ScreenHeader } from "./ui";

export function DuelsView({
  tracker,
  commit,
  activeActivityId,
}: {
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => void;
  activeActivityId: string | null;
}) {
  const auth = useAuth();
  const sync = useCloudSync();
  const [items, setItems] = useState<DuelListItem[] | null>(null);
  const [board, setBoard] = useState<DuelBoard | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const next = await duelsApi.list(client);
    setItems(next);
  }, []);

  const loadBoard = useCallback(async (duelId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const next = await duelsApi.board(client, duelId);
    setBoard(next);
  }, []);

  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("duel");
    if (id) setSelected(id);
  }, []);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let cancelled = false;
    loadList().catch((caught) => {
      if (!cancelled) setError(duelError(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, loadList]);

  useEffect(() => {
    if (!selected || auth.status !== "signed-in") return;
    let cancelled = false;
    loadBoard(selected).catch((caught) => {
      if (!cancelled) setError(duelError(caught));
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadBoard(selected).catch(() => undefined);
    }, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth.status, loadBoard, selected]);

  const refresh = async () => {
    setError(null);
    try {
      await loadList();
      if (selected) await loadBoard(selected);
    } catch (caught) {
      setError(duelError(caught));
    }
  };

  const act = async (work: () => Promise<void>) => {
    setError(null);
    setNote(null);
    try {
      await work();
      await refresh();
    } catch (caught) {
      setError(duelError(caught));
    }
  };

  if (auth.status === "unavailable") {
    return (
      <>
        <ScreenHeader eyebrow="Duels" title="Challenge a friend." />
        <p className="mt-6 text-sm text-text-2">Duels need TapAct cloud sign-in, which isn't configured in this build.</p>
      </>
    );
  }

  if (auth.status === "signed-out") {
    return (
      <>
        <ScreenHeader eyebrow="Duels" title="Challenge a friend." />
        <section className="panel mt-6 px-4 py-6">
          <EmptyState icon={Swords} title="Sign in to start a duel" body="A private 1v1 on daily consistency. Your friend needs their own TapAct account." />
          <a href="/auth?next=%2F%3Ftab%3Dduels" className="btn btn-primary mt-4 h-12 w-full">Sign in</a>
        </section>
      </>
    );
  }

  if (auth.status === "loading" || items === null) {
    return (
      <>
        <ScreenHeader eyebrow="Duels" title="Challenge a friend." />
        <p className="mt-6 text-sm text-text-3" role="status">Loading duels…</p>
      </>
    );
  }

  const pending = items.filter((item) => item.status === "pending");
  const active = items.filter((item) => item.status === "active");
  const done = items.filter((item) => item.status === "completed");
  const unsynced = sync.pending > 0 || sync.status === "offline" || sync.status === "error";

  return (
    <>
      <ScreenHeader eyebrow="Duels" title="Challenge a friend.">
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary mt-4 h-11 px-5">Create duel</button>
      </ScreenHeader>

      {unsynced && (
        <p role="status" className="mt-4 rounded-2xl border border-ember/30 bg-ember/[0.07] px-3 py-2.5 text-xs text-[#FFD3B0]">
          {sync.status === "offline"
            ? "You're offline. Challenge scores aren't final until tracking syncs."
            : "Some tracking hasn't synced yet, so these scores aren't final."}
        </p>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      {note && <p role="status" className="mt-4 text-sm text-mint">{note}</p>}

      {items.length === 0 && !board && (
        <section className="panel mt-6 px-4 py-6">
          <EmptyState icon={Swords} title="No duels yet" body="Pick 1–3 daily targets, choose 7, 14, or 30 days, and send one friend a private link." />
        </section>
      )}

      {pending.length > 0 && (
        <section className="mt-6 space-y-2">
          <h2 className="eyebrow">Waiting for a friend</h2>
          {pending.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelected(item.id)} className="panel flex w-full items-center justify-between px-4 py-3 text-left">
              <span>
                <span className="block text-sm font-semibold text-text-1">{item.title}</span>
                <span className="text-xs text-text-3">Starts {item.startsOn} · {item.durationDays} days</span>
              </span>
              <span className="text-xs text-volt-hi">Invite open</span>
            </button>
          ))}
        </section>
      )}

      {active.map((item) => (
        <button key={item.id} type="button" onClick={() => setSelected(item.id)} className={`panel mt-3 w-full px-4 py-3 text-left ${selected === item.id ? "border-volt/50" : ""}`}>
          <span className="text-sm font-semibold text-text-1">{item.title}</span>
          <span className="mt-0.5 block text-xs text-text-3">{item.durationDays} days from {item.startsOn}</span>
        </button>
      ))}

      {board && selected === board.duel.id && (
        <DuelBoardView
          board={board}
          tracker={tracker}
          commit={commit}
          activeActivityId={activeActivityId}
          unsynced={unsynced}
          onNote={setNote}
          onAct={act}
          onClose={() => {
            setSelected(null);
            setBoard(null);
          }}
        />
      )}

      {done.length > 0 && (
        <section className="mt-8 space-y-2">
          <h2 className="eyebrow">Finished</h2>
          {done.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelected(item.id)} className="panel w-full px-4 py-3 text-left">
              <span className="text-sm font-semibold text-text-1">{item.title}</span>
              <span className="mt-0.5 block text-xs text-text-3">Open the recap</span>
            </button>
          ))}
        </section>
      )}

      <button type="button" onClick={() => void refresh()} className="mt-6 text-sm font-medium text-text-3">Refresh</button>

      {creating && (
        <CreateDuelSheet
          tracker={tracker}
          commit={commit}
          onClose={() => setCreating(false)}
          onCreated={() => void loadList().catch((caught) => setError(duelError(caught)))}
        />
      )}
    </>
  );
}

function DuelBoardView({
  board,
  tracker,
  commit,
  activeActivityId,
  unsynced,
  onNote,
  onAct,
  onClose,
}: {
  board: DuelBoard;
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => void;
  activeActivityId: string | null;
  unsynced: boolean;
  onNote: (note: string | null) => void;
  onAct: (work: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}) {
  const today = board.youDays.find((day) => day.dayKey === board.you.todayKey);
  const friendToday = board.friendDays.find((day) => day.dayKey === board.you.todayKey);
  const dayNumber = board.youDays.findIndex((day) => day.dayKey === board.you.todayKey);
  const mapped = new Map(board.you.mappings.map((item) => [item.challengeActivityId, item.trackerActivityId]));
  const activities = tracker.activities.filter((activity) => activity.archivedAtMs === null);
  const result = board.duel.final
    ? board.duel.winner === "tie"
      ? "It's a tie."
      : board.duel.winner === "you"
        ? "You won."
        : "Your friend won."
    : null;

  return (
    <section className="panel mt-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-1">{board.duel.title}</h2>
          <p className="text-xs text-text-3">
            {board.duel.awaitingOpponent ? "Waiting for your friend" : `You vs ${board.friend?.name ?? "Friend"}`}
            {dayNumber >= 0 ? ` · Day ${dayNumber + 1} of ${board.duel.durationDays}` : ""}
          </p>
          {board.duel.awaitingOpponent && (
            <p className="mt-2 text-xs text-text-3">Points start once your friend accepts. Tracking before then does not count.</p>
          )}
          {board.duel.plannedStartsOn !== board.duel.startsOn && (
            <p className="mt-2 text-xs text-text-2">
              Start moved from {board.duel.plannedStartsOn} to {board.duel.startsOn}. Both of you begin that day, for {board.duel.durationDays} days. Time tracked before {board.duel.startsOn} does not count.
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-xs font-medium text-text-3">Close</button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Score label="You" value={board.you.score} />
        <Score label={board.friend?.name ?? "Friend"} value={board.friend?.score ?? 0} dim={!board.friend} />
      </div>
      {result && (
        <p className="mt-3 text-sm font-semibold text-text-1">
          {unsynced ? "The period has ended. This result isn't final until tracking finishes syncing." : result}
        </p>
      )}
      {board.presence && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-ice/30 bg-ice/10 px-3 py-2">
          <p className="text-sm text-text-1">{board.presence.name} is {board.presence.activity.toLowerCase()}</p>
          {mappedTracker(board, board.presence.activityId, activities) && (
            <button
              type="button"
              className="text-xs font-semibold text-ice"
              onClick={() => {
                const id = mappedTracker(board, board.presence!.activityId, activities);
                if (id) commit((base) => toggleActivity(base, id, Date.now()));
              }}
            >
              Start mine
            </button>
          )}
        </div>
      )}

      <div className={`mt-4 grid gap-1 ${board.duel.durationDays === 30 ? "grid-cols-10" : "grid-cols-7"}`} aria-label="Consistency calendar">
        {board.youDays.map((day, index) => {
          const friend = board.friendDays.find((item) => item.dayKey === day.dayKey);
          const met = day.activities.filter((activity) => activity.met).length;
          const tone = day.bonus ? "bg-volt text-ink-0" : met > 0 ? "bg-ice/25 text-text-1" : "bg-white/5 text-text-3";
          return (
            <div
              key={day.dayKey}
              title={`${day.dayKey}: you ${day.points}${friend ? `, friend ${friend.points}` : ""}`}
              className={`grid aspect-square place-items-center rounded-md text-[0.65rem] font-semibold ${tone}`}
            >
              <span className="sr-only">{day.dayKey}, {day.points} points</span>
              {index + 1}
            </div>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        {board.activities.map((activity) => {
          const yours = today?.activities.find((item) => item.id === activity.id);
          const theirs = friendToday?.activities.find((item) => item.id === activity.id);
          const trackerId = mapped.get(activity.id) ?? "";
          return (
            <div key={activity.id}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-text-1">{activity.name}</span>
                <span className="text-xs text-text-3">{activity.targetMinutes} min</span>
              </div>
              <Meter label="You" minutes={yours?.minutes ?? 0} target={activity.targetMinutes} met={yours?.met ?? false} />
              {board.friend && <Meter label={board.friend.name} minutes={theirs?.minutes ?? 0} target={activity.targetMinutes} met={theirs?.met ?? false} />}
              {board.you.status === "active" && (
                <label className="mt-1 block text-xs text-text-3">
                  Your activity
                  <select
                    className="field mt-1"
                    value={trackerId}
                    onChange={(event) => {
                      const value = event.target.value || null;
                      void onAct(async () => {
                        const client = getSupabaseBrowserClient();
                        if (!client) return;
                        await duelsApi.map(client, board.duel.id, activity.id, value);
                      });
                    }}
                  >
                    <option value="">Not mapped</option>
                    {activities.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {!trackerId && board.you.status === "active" && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-volt-hi"
                  onClick={() => {
                    const id = createActivityId(activity.name);
                    commit((base) => addActivity(base, { id, name: activity.name, iconKey: "briefcase", color: "#8E7BFF", goalMinutes: activity.targetMinutes, cue: "Duel activity" }));
                    void onAct(async () => {
                      const client = getSupabaseBrowserClient();
                      if (!client) return;
                      await duelsApi.map(client, board.duel.id, activity.id, id);
                    });
                  }}
                >
                  Create a matching activity
                </button>
              )}
            </div>
          );
        })}
      </div>

      {board.duel.awaitingOpponent && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn btn-ghost h-11 flex-1"
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
          <button
            type="button"
            className="btn btn-ghost h-11 flex-1"
            onClick={() => {
              if (!window.confirm("Revoke this invite? Your friend won't be able to join with the current link.")) return;
              void onAct(async () => {
                const client = getSupabaseBrowserClient();
                if (!client) return;
                await duelsApi.revoke(client, board.duel.id);
              });
            }}
          >
            Revoke
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2 text-sm text-text-2">
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span>Share when I'm tracking a duel activity</span>
          <input
            type="checkbox"
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
      </div>

      {board.you.status === "active" && (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-danger"
          onClick={() => {
            const message = board.duel.awaitingOpponent
              ? "Leaving cancels this duel and revokes the invite."
              : "Leaving stops new points for you. Points already earned stay, and your friend can finish.";
            if (!window.confirm(message)) return;
            void onAct(async () => {
              const client = getSupabaseBrowserClient();
              if (!client) return;
              await duelsApi.leave(client, board.duel.id);
              onClose();
            });
          }}
        >
          Leave duel
        </button>
      )}
      <p className="mt-3 text-[0.7rem] leading-relaxed text-text-3">Only timer time on mapped activities counts. Hand-added or edited sessions stay in History and do not score.</p>
    </section>
  );
}

function Score({ label, value, dim = false }: { label: string; value: number; dim?: boolean }) {
  return (
    <div className={`rounded-2xl border border-line px-3 py-3 ${dim ? "opacity-50" : ""}`}>
      <p className="text-xs text-text-3">{label}</p>
      <p className="numeric text-2xl font-semibold text-text-1">{value}</p>
    </div>
  );
}

function Meter({ label, minutes, target, met }: { label: string; minutes: number; target: number; met: boolean }) {
  const width = Math.min(100, Math.round((minutes / Math.max(target, 1)) * 100));
  return (
    <div className="mt-1">
      <div className="flex justify-between text-[0.7rem] text-text-3">
        <span>{label}</span>
        <span>{minutes}/{target} min{met ? " · done" : ""}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" role="meter" aria-valuenow={minutes} aria-valuemin={0} aria-valuemax={target} aria-label={`${label} ${activityProgress(minutes, target)}`}>
        <div className={`h-full rounded-full ${met ? "bg-mint" : "bg-volt"}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function activityProgress(minutes: number, target: number): string {
  return `${minutes} of ${target} minutes`;
}

function mappedTracker(board: DuelBoard, challengeActivityId: string, activities: TrackerState["activities"]): string | null {
  const mapping = board.you.mappings.find((item) => item.challengeActivityId === challengeActivityId);
  if (!mapping) return null;
  return activities.some((item) => item.id === mapping.trackerActivityId) ? mapping.trackerActivityId : null;
}
