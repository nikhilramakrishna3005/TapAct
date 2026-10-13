"use client";

import { Swords } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { duelError, duelsApi, type DuelBoard, type DuelListItem } from "@/lib/duels/api";
import { battleFromBoard, type ShowcaseBattle } from "@/lib/duels/showcase";
import type { TrackerState } from "@/lib/tracker";
import type { TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { useCloudSync } from "./CloudSync";
import { BattleShowcase } from "./duels/BattleShowcase";
import { CreateDuelSheet } from "./duels/CreateDuelSheet";
import { DuelArena } from "./duels/DuelArena";
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
  const [battles, setBattles] = useState<ShowcaseBattle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [connectOnOpen, setConnectOnOpen] = useState(false);
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
    setSelected((current) => current ?? items.find((item) => item.status === "active")?.id ?? items.find((item) => item.status === "pending")?.id ?? null);
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

  const unsynced = sync.pending > 0 || sync.status === "offline" || sync.status === "error";
  const showing = board && selected === board.duel.id ? board : null;

  return (
    <>
      <ScreenHeader eyebrow="Duels" title="The arena.">
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

      {items.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold ${selected === item.id ? "border-volt/60 text-text-1" : "border-line text-text-3"}`}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <section className="panel mt-4 px-4 py-6">
          <EmptyState icon={Swords} title="No duels yet" body="Pick 1–3 daily targets, choose 7, 14, or 30 days, and send one friend a private link." />
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
          onNote={setNote}
          onAct={act}
          onClose={() => {
            setSelected(null);
            setBoard(null);
          }}
        />
      )}

      {!showing && <BattleShowcase battles={battles} />}

      <button type="button" onClick={() => void refresh()} className="mt-4 min-h-11 text-sm font-medium text-text-3">Refresh</button>

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
