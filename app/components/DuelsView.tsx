"use client";

import { MoreHorizontal, Swords } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { duelError, duelsApi, type DuelBoard, type DuelListItem } from "@/lib/duels/api";
import {
  alreadyResolvedDuelAction,
  archivedDuelAction,
  duelActionCopy,
  duelMenuAction,
  partitionDuelLists,
  restoreCopy,
  type DuelMenuAction,
} from "@/lib/duels/manage";
import { battleFromBoard, type ShowcaseBattle } from "@/lib/duels/showcase";
import type { TrackerState } from "@/lib/tracker";
import type { TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { useCloudSync } from "./CloudSync";
import { ConfirmSheet } from "./duels/ConfirmSheet";
import { BattleShowcase } from "./duels/BattleShowcase";
import { CreateDuelSheet } from "./duels/CreateDuelSheet";
import { DuelArena } from "./duels/DuelArena";
import { EmptyState, ScreenHeader, Sheet } from "./ui";

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
  const [battles, setBattles] = useState<ShowcaseBattle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [connectOnOpen, setConnectOnOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: DuelMenuAction | "restore" } | null>(null);
  const [acting, setActing] = useState(false);
  const actingLock = useRef(false);
  const opened = useRef(false);

  const loadHistory = useCallback(async (list: DuelListItem[]) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const finished = list.filter((item) => item.status === "completed" || item.status === "active");
    const boards = await Promise.all(finished.map((item) => duelsApi.board(client, item.id).catch(() => null)));
    const next = boards.flatMap((item) => {
      const battle = item ? battleFromBoard(item) : null;
      return battle ? [battle] : [];
    });
    next.sort((a, b) => (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0));
    setBattles(next);
  }, []);

  const loadList = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const next = await duelsApi.list(client);
    setItems(next);
    await loadHistory(next);
  }, [loadHistory]);

  const loadBoard = useCallback(async (duelId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBoard(await duelsApi.board(client, duelId));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const duel = url.searchParams.get("duel");
    if (duel) setSelected(duel);
    if (url.searchParams.get("connect") === "1") {
      setConnectOnOpen(true);
      url.searchParams.delete("connect");
      window.history.replaceState(window.history.state, "", url);
    }
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
    if (!items || opened.current) return;
    opened.current = true;
    const { main } = partitionDuelLists(items);
    setSelected((current) => current ?? main.find((item) => item.status === "active")?.id ?? main.find((item) => item.status === "pending")?.id ?? null);
  }, [items]);

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

  const act = async (work: () => Promise<void>, success?: string) => {
    if (actingLock.current) return;
    actingLock.current = true;
    setActing(true);
    setError(null);
    setNote(null);
    try {
      await work();
      await refresh();
      if (success) setNote(success);
    } catch (caught) {
      const message = duelError(caught);
      if (alreadyResolvedDuelAction(message)) {
        await refresh();
        setNote(success ?? "That's already done.");
      } else {
        setError(message);
        if (selected) void loadBoard(selected).catch(() => undefined);
      }
    } finally {
      actingLock.current = false;
      setActing(false);
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

  const unsynced = sync.pending > 0 || sync.status === "offline" || sync.status === "error";
  const { main, archived } = partitionDuelLists(items);
  const showing = board && selected === board.duel.id ? board : null;
  const menuItem = items.find((item) => item.id === menuId) ?? null;
  const confirmItem = items.find((item) => item.id === confirm?.id) ?? null;
  const confirmCopy = confirmItem && confirm
    ? confirm.action === "restore"
      ? restoreCopy(confirmItem.title)
      : duelActionCopy(confirm.action, confirmItem.title)
    : null;

  const runAction = (id: string, action: DuelMenuAction | "restore") => {
    void act(async () => {
      const client = getSupabaseBrowserClient();
      if (!client) return;
      if (action === "cancel") await duelsApi.revoke(client, id);
      else if (action === "leave") await duelsApi.leave(client, id);
      else if (action === "archive") await duelsApi.archive(client, id);
      else await duelsApi.restore(client, id);
      if (action === "cancel" || action === "archive") {
        setSelected((current) => (current === id ? null : current));
        if (selected === id) setBoard(null);
      }
    }, action === "cancel" ? "Duel cancelled." : action === "leave" ? "You left this duel." : action === "archive" ? "Removed from your list." : "Duel restored.");
  };

  return (
    <>
      <ScreenHeader eyebrow="Duels" title="The arena." />

      {unsynced && (
        <p role="status" className="mt-4 rounded-2xl border border-ember/30 bg-ember/[0.07] px-3 py-2.5 text-xs text-[#FFD3B0]">
          {sync.status === "offline"
            ? "You're offline. Challenge scores aren't final until tracking syncs."
            : "Some tracking hasn't synced yet, so these scores aren't final."}
        </p>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      {note && <p role="status" className="mt-4 text-sm text-mint">{note}</p>}

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="eyebrow">Your duels</p>
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary h-11 px-4">Create duel</button>
      </div>

      {main.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {main.map((item) => {
            const action = duelMenuAction(item);
            return (
              <div key={item.id} className={`flex min-h-11 items-center rounded-full border ${selected === item.id ? "border-volt/60" : "border-line"}`}>
                <button
                  type="button"
                  aria-pressed={selected === item.id}
                  onClick={() => setSelected(item.id)}
                  className={`min-h-11 max-w-[9.5rem] truncate px-3 text-xs font-semibold ${selected === item.id ? "text-text-1" : "text-text-3"}`}
                >
                  {item.title}
                </button>
                {action && (
                  <button
                    type="button"
                    aria-label={`Actions for ${item.title}`}
                    className="grid size-11 place-items-center text-text-3"
                    onClick={() => setMenuId(item.id)}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {main.length === 0 && !showing && (
        <section className="panel mt-3 px-4 py-6">
          <EmptyState
            icon={Swords}
            title={archived.length > 0 ? "No open duels" : "No duels yet"}
            body={archived.length > 0 ? "Cancelled and removed duels are in Archived. Restore a completed one, or create a new duel." : "Pick 1–3 daily targets, choose 7, 14, or 30 days, and send one friend a private link."}
          />
        </section>
      )}

      {showing && (
        <DuelArena
          key={showing.duel.id}
          board={showing}
          tracker={tracker}
          commit={commit}
          activeActivityId={activeActivityId}
          unsynced={unsynced}
          connectOnOpen={connectOnOpen}
          battles={battles}
          busy={acting}
          onNote={setNote}
          onAct={act}
          onClose={() => {
            setSelected(null);
            setBoard(null);
          }}
        />
      )}

      {!showing && <BattleShowcase battles={battles} />}

      <details className="mt-4 rounded-[18px] border border-line bg-ink-1 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-text-1">Archived duels</summary>
        {archived.length === 0 ? (
          <p className="pb-3 text-xs text-text-3">Cancelled and removed duels appear here. Official results stay.</p>
        ) : (
          <ul className="space-y-2 pb-3">
            {archived.map((item) => {
              const action = archivedDuelAction(item);
              return (
                <li key={item.id} className="flex items-center justify-between gap-2 rounded-2xl border border-line px-3 py-2">
                  <button type="button" onClick={() => setSelected(item.id)} className="min-w-0 text-left">
                    <span className="block truncate text-sm font-semibold text-text-1">{item.title}</span>
                    <span className="block text-xs text-text-3">{item.status === "cancelled" ? "Cancelled" : "Completed"} · {item.startsOn}</span>
                  </button>
                  {action && (
                    <button
                      type="button"
                      disabled={acting}
                      className="min-h-11 shrink-0 px-2 text-xs font-semibold text-volt-hi"
                      onClick={() => setConfirm({ id: item.id, action })}
                    >
                      {action === "restore" ? "Restore" : "Remove from my list"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </details>

      <button type="button" onClick={() => void refresh()} className="mt-4 min-h-11 text-sm font-medium text-text-3">Refresh</button>

      {creating && (
        <CreateDuelSheet
          tracker={tracker}
          commit={commit}
          onClose={() => setCreating(false)}
          onCreated={() => void loadList().catch((caught) => setError(duelError(caught)))}
        />
      )}

      {menuItem && (
        <Sheet label={menuItem.title} onClose={() => setMenuId(null)}>
          <p className="mt-3 text-xs text-text-3">
            {menuItem.status === "pending" ? "This invite is still waiting." : menuItem.status === "active" ? "This duel is in progress." : "This duel is finished."}
          </p>
          {duelMenuAction(menuItem) && (
            <button
              type="button"
              className={`btn mt-4 h-12 w-full ${duelMenuAction(menuItem) === "archive" ? "btn-ghost" : "btn-ghost text-danger"}`}
              onClick={() => {
                const action = duelMenuAction(menuItem);
                if (!action) return;
                setMenuId(null);
                setConfirm({ id: menuItem.id, action });
              }}
            >
              {duelMenuAction(menuItem) === "cancel" ? "Cancel duel" : duelMenuAction(menuItem) === "leave" ? "Leave duel" : "Remove from my list"}
            </button>
          )}
        </Sheet>
      )}

      {confirm && confirmCopy && (
        <ConfirmSheet
          {...confirmCopy}
          busy={acting}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const next = confirm;
            setConfirm(null);
            runAction(next.id, next.action);
          }}
        />
      )}
    </>
  );
}
