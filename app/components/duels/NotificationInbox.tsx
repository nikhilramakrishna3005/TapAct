"use client";

import { Bell, Check } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { duelError, duelsApi } from "@/lib/duels/api";
import {
  emptyNotificationPage,
  isMissingNotificationRpc,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotificationPages,
  notificationTimeLabel,
  type DuelNotification,
  type NotificationPage,
} from "@/lib/duels/notifications";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { EmptyState, ScreenHeader, Sheet } from "../ui";

const PAGE_SIZE = 30;
const REFRESH_GAP_MS = 60_000;

type InboxContextValue = {
  enabled: boolean;
  unread: number;
  open: boolean;
  openInbox: () => void;
};

const InboxContext = createContext<InboxContextValue | null>(null);

export function NotificationBellButton() {
  const inbox = useContext(InboxContext);
  if (!inbox?.enabled) return null;
  const label = inbox.unread > 0 ? `Notifications, ${inbox.unread} unread` : "Notifications";
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={inbox.open}
      onClick={inbox.openInbox}
      className="relative grid size-11 shrink-0 place-items-center rounded-full border border-line-strong text-text-2 transition-colors hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
    >
      <Bell className="size-4" aria-hidden="true" />
      {inbox.unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[linear-gradient(135deg,var(--volt),var(--ice))] px-1 text-[0.6rem] font-bold leading-none text-ink-0"
        >
          {inbox.unread > 9 ? "9+" : inbox.unread}
        </span>
      )}
    </button>
  );
}

export function NotificationScreenHeader({
  eyebrow,
  title,
  children,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <ScreenHeader eyebrow={eyebrow} title={title} compact={compact} trailing={<NotificationBellButton />}>
      {children}
    </ScreenHeader>
  );
}

export function DuelNotificationProvider({
  enabled,
  onOpenDuel,
  onSynced,
  children,
}: {
  enabled: boolean;
  onOpenDuel: (duelId: string) => void;
  onSynced?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<NotificationPage>(emptyNotificationPage());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const inflight = useRef<Promise<void> | null>(null);
  const lastRefresh = useRef(0);
  const pageRef = useRef(page);
  const onSyncedRef = useRef(onSynced);
  const onOpenRef = useRef(onOpenDuel);
  pageRef.current = page;
  onSyncedRef.current = onSynced;
  onOpenRef.current = onOpenDuel;

  const refresh = useCallback((reason: "lifecycle" | "inbox" | "more") => {
    if (!enabled || unavailable) return Promise.resolve();
    if (reason === "lifecycle" && !inflight.current && Date.now() - lastRefresh.current < REFRESH_GAP_MS) {
      return Promise.resolve();
    }
    if (reason !== "lifecycle") setLoading(true);
    if (inflight.current) return inflight.current;
    const client = getSupabaseBrowserClient();
    if (!client) {
      setLoading(false);
      return Promise.resolve();
    }
    const cursor = reason === "more" ? pageRef.current.items.at(-1) ?? null : null;
    if (reason === "more" && !cursor) {
      setLoading(false);
      return Promise.resolve();
    }

    const run = (async () => {
      if (reason !== "more") {
        await duelsApi.reconcileNotifications(client);
        onSyncedRef.current?.();
      }
      const next = await duelsApi.notifications(client, {
        limit: PAGE_SIZE,
        before: cursor?.createdAt ?? null,
        beforeId: cursor?.id ?? null,
      });
      setPage((current) => (
        reason === "more"
          ? { unread: next.unread, hasMore: next.hasMore, items: mergeNotificationPages(current.items, next.items) }
          : next
      ));
      lastRefresh.current = Date.now();
      setError(null);
    })();
    inflight.current = run;
    return run.catch((caught: unknown) => {
      if (isMissingNotificationRpc(caught)) {
        setUnavailable(true);
        setPage(emptyNotificationPage());
        return;
      }
      setError(duelError(caught));
    }).finally(() => {
      if (inflight.current === run) inflight.current = null;
      setLoading(false);
    });
  }, [enabled, unavailable]);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setPage(emptyNotificationPage());
      setError(null);
      return;
    }
    void refresh("lifecycle");
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh("lifecycle");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, refresh]);

  const openInbox = useCallback(() => {
    setNowMs(Date.now());
    setOpen(true);
    void refresh("inbox");
  }, [refresh]);

  const markOne = useCallback(async (item: DuelNotification) => {
    if (item.readAt) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const readAt = new Date().toISOString();
    setPage((current) => ({
      ...current,
      unread: Math.max(0, current.unread - 1),
      items: markNotificationRead(current.items, item.id, readAt),
    }));
    try {
      await duelsApi.markNotificationRead(client, item.id);
    } catch (caught) {
      if (!isMissingNotificationRpc(caught)) setError(duelError(caught));
    }
  }, []);

  const markAll = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const readAt = new Date().toISOString();
    setPage((current) => ({
      ...current,
      unread: 0,
      items: markAllNotificationsRead(current.items, readAt),
    }));
    try {
      await duelsApi.markAllNotificationsRead(client);
    } catch (caught) {
      if (!isMissingNotificationRpc(caught)) setError(duelError(caught));
    }
  }, []);

  const openItem = useCallback(async (item: DuelNotification) => {
    await markOne(item);
    setOpen(false);
    onOpenRef.current(item.duelId);
  }, [markOne]);

  return (
    <InboxContext.Provider value={{ enabled, unread: page.unread, open, openInbox }}>
      {children}
      <AnimatePresence>
        {open && (
          <Sheet label="Notifications" onClose={() => setOpen(false)}>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-text-3">Duel updates</p>
              {page.unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAll()}
                  className="min-h-11 px-1 text-xs font-semibold text-volt-hi"
                >
                  Mark all read
                </button>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">{error}</p>
            )}

            {unavailable && (
              <p className="mt-4 text-sm text-text-2">
                Notifications will appear here after the latest TapAct update is applied.
              </p>
            )}

            {loading && page.items.length === 0 && !unavailable && (
              <p role="status" className="mt-4 text-sm text-text-3">Loading notifications…</p>
            )}

            {!loading && !error && !unavailable && page.items.length === 0 && (
              <div className="mt-4">
                <EmptyState
                  icon={Bell}
                  title="No duel updates yet"
                  body="You'll see accepted invites, rule changes, and results here."
                />
              </div>
            )}

            {page.items.length > 0 && (
              <ul className="mt-3 space-y-2" aria-label="Duel notifications">
                {page.items.map((item) => (
                  <li
                    key={item.id}
                    className={`rounded-[18px] border px-2 py-1 ${
                      item.readAt
                        ? "border-line bg-ink-0"
                        : "border-volt/35 bg-[linear-gradient(180deg,rgba(142,123,255,0.14),rgba(95,227,255,0.05))]"
                    }`}
                  >
                    <div className="flex items-start gap-1">
                      <button
                        type="button"
                        onClick={() => void openItem(item)}
                        className="min-h-11 min-w-0 flex-1 px-1 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
                      >
                        <span className="flex items-center gap-2">
                          {!item.readAt && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-ice" />}
                          <span className="truncate text-sm font-semibold text-text-1">{item.title}</span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-text-2">{item.body}</span>
                        <span className="mt-1 block text-[0.65rem] font-medium text-text-3">
                          {notificationTimeLabel(item.createdAt, nowMs)}
                        </span>
                      </button>
                      {!item.readAt && (
                        <button
                          type="button"
                          aria-label={`Mark ${item.title} as read`}
                          onClick={() => void markOne(item)}
                          className="grid size-11 shrink-0 place-items-center rounded-full text-text-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {page.hasMore && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void refresh("more")}
                className="mt-3 min-h-11 w-full text-sm font-semibold text-volt-hi disabled:opacity-40"
              >
                {loading ? "Loading…" : "Load older"}
              </button>
            )}
          </Sheet>
        )}
      </AnimatePresence>
    </InboxContext.Provider>
  );
}
