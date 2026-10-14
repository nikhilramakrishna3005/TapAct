"use client";

import { AnimatePresence, motion } from "motion/react";
import { Archive, ChevronDown, PencilLine, Plus, Radio, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { SYNC_DIRTY_EVENT } from "@/lib/sync/capture";
import { runningSegment } from "@/lib/sync/merge";
import { SYNC_CACHE_KEY, SYNC_META_KEY } from "@/lib/sync/state";
import {
  buildDayTimeline,
  getHourMarks,
  loadRecordedSegments,
  type RecordedSegments,
  type TimelineSession,
} from "@/lib/timeline";
import type { TrackerState } from "@/lib/tracker";
import { useCloudSync } from "./CloudSync";
import { DeleteSessionSheet, SessionEditorSheet } from "./SessionSheet";
import { formatSummaryDuration, ICON_REGISTRY, SectionCard, tint } from "./ui";

const LABELED_HOURS = [0, 6, 12, 18, 24];
const COLLAPSED_LIST_COUNT = 6;
/** Taps this close to a short session still select it. */
const TAP_SLOP_PX = 18;

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Re-reads recorded segments after commits, syncs, and other tabs' writes. */
function useRecordedSegments(revision: number): RecordedSegments | null {
  const [version, setVersion] = useState(0);
  const [segments, setSegments] = useState<RecordedSegments | null>(null);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SYNC_META_KEY || event.key === SYNC_CACHE_KEY) bump();
    };
    window.addEventListener(SYNC_DIRTY_EVENT, bump);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(SYNC_DIRTY_EVENT, bump);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    setSegments(loadRecordedSegments(getStorage()));
  }, [revision, version]);

  return segments;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatHourLabel(hour: number): string {
  const date = new Date(2000, 0, 1, hour % 24);
  return date.toLocaleTimeString(undefined, { hour: "numeric" }).replace(/\s/g, "\u202F");
}

function formatMoment(ms: number, dayStartMs: number, dayEndMs: number): string {
  if (ms >= dayStartMs && ms <= dayEndMs) return formatTime(ms);
  const date = new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date}, ${formatTime(ms)}`;
}

function formatDuration(ms: number): string {
  return ms < 60_000 ? "<1m" : formatSummaryDuration(ms);
}

function describeSession(session: TimelineSession): string {
  const end = session.live ? "now" : formatTime(session.endMs);
  return `${session.activity.name}, ${formatTime(session.startMs)} to ${end}, ${formatDuration(session.endMs - session.startMs)}`;
}

export function OrbitTimeline({
  tracker,
  dayKey,
  nowMs,
  isToday,
}: {
  tracker: TrackerState;
  dayKey: string;
  nowMs: number;
  isToday: boolean;
}) {
  const recorded = useRecordedSegments(tracker.revision);
  const { rescueSession } = useCloudSync();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<{ session: TimelineSession | null } | null>(null);
  const [deleting, setDeleting] = useState<TimelineSession | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const canEdit = recorded?.canEdit ?? false;
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeDelete = useCallback(() => setDeleting(null), []);

  const timeline = useMemo(() => {
    const live = recorded?.owned ? runningSegment(tracker, recorded.deviceId, recorded.floor) : null;
    return buildDayTimeline({
      dayKey,
      entries: recorded?.entries ?? [],
      activities: tracker.activities,
      dailyRecords: tracker.dailyRecords,
      live,
    });
  }, [dayKey, recorded, tracker]);

  const hourMarks = useMemo(() => getHourMarks(dayKey), [dayKey]);
  const { sessions, laneCount, untimed } = timeline;
  const dayLength = timeline.endMs - timeline.startMs;
  const ratioOf = (ms: number) => Math.min(1, Math.max(0, (ms - timeline.startMs) / dayLength));
  const nowRatio = isToday ? ratioOf(nowMs) : null;

  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const listed = expanded ? sessions : sessions.slice(0, COLLAPSED_LIST_COUNT);

  const laneGap = 4;
  const laneHeight = laneCount === 1 ? 40 : laneCount === 2 ? 20 : 16;
  const trackHeight = laneCount * laneHeight + (laneCount - 1) * laneGap + 12;

  const selectAt = (clientX: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = clientX - rect.left;
    const lane = Math.floor(((clientY - rect.top - 6) / (trackHeight - 12)) * laneCount);
    let best: { id: string; score: number } | null = null;
    for (const session of sessions) {
      const left = ratioOf(session.dayStartMs) * rect.width;
      const right = Math.max(left + 4, ratioOf(session.dayEndMs) * rect.width);
      const distance = x < left ? left - x : x > right ? x - right : 0;
      if (distance > TAP_SLOP_PX) continue;
      const score = distance + (session.lane === lane ? 0 : TAP_SLOP_PX * 2);
      if (!best || score < best.score) best = { id: session.id, score };
    }
    setSelectedId(best ? (best.id === selectedId ? null : best.id) : null);
  };

  const moveSelection = (delta: number) => {
    if (sessions.length === 0) return;
    const index = selected ? sessions.indexOf(selected) : delta > 0 ? -1 : sessions.length;
    const next = sessions[Math.min(sessions.length - 1, Math.max(0, index + delta))];
    setSelectedId(next.id);
    trackRef.current?.querySelector<HTMLElement>(`[data-session="${CSS.escape(next.id)}"]`)?.focus();
  };

  const hasAnything = sessions.length > 0 || untimed.length > 0;

  return (
    <SectionCard
      title="Timeline"
      aside={
        <div className="flex items-center gap-2">
          <p className="text-xs text-text-3">
            {sessions.length > 0
              ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
              : untimed.length > 0
                ? "Totals only"
                : "24 hours"}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditor({ session: null })}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong bg-ink-0 px-3 text-xs font-medium text-text-1 transition-colors hover:border-volt/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
            >
              <Plus className="size-3.5" />
              Add
            </button>
          )}
        </div>
      }
    >
      <div className="relative">
        <div
          ref={trackRef}
          role="group"
          aria-label="24-hour timeline. Use arrow keys to move between sessions."
          className="relative cursor-pointer touch-manipulation select-none overflow-hidden rounded-[16px] border border-line bg-ink-0"
          style={{ height: trackHeight }}
          onClick={(event) => {
            if (event.detail === 0) return;
            selectAt(event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              moveSelection(event.key === "ArrowRight" ? 1 : -1);
            } else if (event.key === "Escape") {
              setSelectedId(null);
            }
          }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 140% at 50% 120%, rgba(142,123,255,0.10), transparent 60%), radial-gradient(80% 120% at 50% -40%, rgba(95,227,255,0.06), transparent 60%)",
            }}
          />
          {hourMarks.slice(1, -1).map((mark) => (
            <span
              key={mark.hour}
              aria-hidden="true"
              className="absolute inset-y-0 w-px"
              style={{
                left: `${mark.ratio * 100}%`,
                background: mark.hour % 6 === 0 ? "var(--tick)" : "var(--wash)",
              }}
            />
          ))}
          {nowRatio !== null && nowRatio < 1 && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 right-0"
              style={{
                left: `${nowRatio * 100}%`,
                background:
                  "repeating-linear-gradient(135deg, var(--hatch) 0 2px, transparent 2px 7px)",
              }}
            />
          )}

          {sessions.map((session, index) => {
            const left = ratioOf(session.dayStartMs) * 100;
            const width = (ratioOf(session.dayEndMs) - ratioOf(session.dayStartMs)) * 100;
            const isSelected = session.id === selectedId;
            const dimmed = selected !== null && !isSelected;
            const color = session.activity.color;
            return (
              <motion.button
                key={session.id}
                type="button"
                data-session={session.id}
                aria-label={describeSession(session)}
                aria-pressed={isSelected}
                onFocus={() => setSelectedId(session.id)}
                className="pointer-events-none absolute origin-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-1"
                style={{
                  left: `${left}%`,
                  width: `max(4px, ${width}%)`,
                  top: 6 + session.lane * (laneHeight + laneGap),
                  height: laneHeight,
                  borderRadius: `${session.continuesFromPreviousDay ? 3 : 999}px ${session.continuesIntoNextDay ? 3 : 999}px ${session.continuesIntoNextDay ? 3 : 999}px ${session.continuesFromPreviousDay ? 3 : 999}px`,
                  background: session.manual
                    ? `repeating-linear-gradient(135deg, var(--stripe) 0 2px, transparent 2px 6px), linear-gradient(180deg, ${tint(color, 0.85)}, ${tint(color, 0.6)})`
                    : `linear-gradient(180deg, ${tint(color, 0.95)}, ${tint(color, 0.7)})`,
                  boxShadow: isSelected
                    ? `0 0 0 1.5px color-mix(in srgb, var(--text-1) 90%, transparent), 0 0 18px ${tint(color, 0.7)}`
                    : `0 0 12px -2px ${tint(color, 0.45)}, inset 0 1px 0 var(--bar-inset)`,
                  transition: "box-shadow var(--dur-quick) var(--ease-out)",
                }}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: dimmed ? 0.4 : 1 }}
                transition={{
                  scaleX: { duration: DURATION.slow, ease: EASE_OUT, delay: Math.min(index, 10) * 0.025 },
                  opacity: { duration: DURATION.quick, ease: EASE_OUT },
                }}
              />
            );
          })}

          {nowRatio !== null && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-ice"
              style={{ left: `${nowRatio * 100}%`, boxShadow: "0 0 10px rgba(95,227,255,0.8)" }}
            >
              <span className="ambient-breathe absolute -top-[1px] left-1/2 size-[6px] -translate-x-1/2 rounded-full bg-ice" />
            </span>
          )}
        </div>

        <div aria-hidden="true" className="relative mt-1.5 h-4 text-[0.6rem] font-medium text-text-3">
          {LABELED_HOURS.map((hour) => {
            const mark = hourMarks[hour];
            const align = hour === 0 ? "translate-x-0" : hour === 24 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={hour} className={`numeric absolute top-0 ${align}`} style={{ left: `${mark.ratio * 100}%` }}>
                {formatHourLabel(hour)}
              </span>
            );
          })}
        </div>
      </div>

      <div aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          {selected && (
            <SessionDetail
              key={selected.id}
              session={selected}
              dayStartMs={timeline.startMs}
              dayEndMs={timeline.endMs}
              nowMs={nowMs}
              editHint={
                canEdit
                  ? selected.live
                    ? "Stop the timer to edit this session."
                    : null
                  : recorded?.owned
                    ? "Sync once with your account to edit sessions."
                    : "Sign in and sync to edit sessions."
              }
              onEdit={canEdit && !selected.live ? () => setEditor({ session: selected }) : undefined}
              onDelete={canEdit && !selected.live ? () => setDeleting(selected) : undefined}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {editor && (
          <SessionEditorSheet
            key="session-editor"
            session={editor.session}
            dayKey={dayKey}
            tracker={tracker}
            entries={recorded?.entries ?? []}
            nowMs={nowMs}
            untimedMs={untimed.reduce((sum, item) => sum + item.ms, 0)}
            onSubmit={(change) => {
              const result = rescueSession(change);
              if (result.ok && change.kind === "save") {
                setSelectedId(`${change.draft.activityId}:${Math.round(change.draft.startMs)}`);
              }
              return result;
            }}
            onDelete={() => {
              const session = editor.session;
              setEditor(null);
              setDeleting(session);
            }}
            onClose={closeEditor}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {deleting && (
          <DeleteSessionSheet
            key="session-delete"
            session={deleting}
            onConfirm={() => {
              const result = rescueSession({ kind: "delete", replaceIds: deleting.entryIds });
              if (result.ok) setSelectedId(null);
              return result;
            }}
            onClose={closeDelete}
          />
        )}
      </AnimatePresence>

      {!hasAnything && (
        <p className="mt-3 text-center text-xs text-text-3">Nothing tracked this day.</p>
      )}

      {sessions.length > 0 && (
        <ul className="mt-3" aria-label="Sessions">
          {listed.map((session) => {
            const isSelected = session.id === selectedId;
            const Icon = ICON_REGISTRY[session.activity.iconKey].icon;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(isSelected ? null : session.id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-200 hover:bg-[var(--wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
                  style={isSelected ? { background: tint(session.activity.color, 0.1) } : undefined}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-[10px]"
                    style={{ color: session.activity.color, background: tint(session.activity.color, 0.12) }}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium text-text-1">
                      <span className="truncate">{session.activity.name}</span>
                      {session.live && <LiveBadge />}
                      {session.manual && <ManualBadge />}
                      {session.activity.archivedAtMs !== null && <ArchivedBadge />}
                    </span>
                    <span className="numeric block text-xs text-text-3">
                      {session.continuesFromPreviousDay ? "Midnight" : formatTime(session.dayStartMs)} –{" "}
                      {session.live ? "Now" : session.continuesIntoNextDay ? "midnight" : formatTime(session.dayEndMs)}
                    </span>
                  </span>
                  <span className="numeric shrink-0 text-sm font-semibold text-text-2">
                    {formatDuration(session.dayEndMs - session.dayStartMs)}
                  </span>
                </button>
              </li>
            );
          })}
          {sessions.length > COLLAPSED_LIST_COUNT && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="mt-1 flex min-h-10 w-full items-center justify-center gap-1 rounded-[14px] text-xs font-medium text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
              >
                {expanded ? "Show fewer" : `Show all ${sessions.length} sessions`}
                <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
            </li>
          )}
        </ul>
      )}

      {untimed.length > 0 && (
        <div className="mt-3 rounded-[16px] border border-dashed border-line-strong px-3.5 py-3">
          <p className="eyebrow !text-[0.58rem] !tracking-[0.18em]">Daily totals</p>
          <p className="mt-1 text-xs leading-relaxed text-text-3">
            {sessions.length === 0 ? "This day was" : "Some time this day was"} recorded as a total only, so exact
            times aren&apos;t available.
            {recorded && !recorded.owned && " Sync with an account to keep session times from now on."}
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {untimed.map(({ activity, ms }) => (
              <li key={activity.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: activity.color }} />
                  <span className="truncate text-text-1">{activity.name}</span>
                  {activity.archivedAtMs !== null && <ArchivedBadge />}
                </span>
                <span className="numeric shrink-0 font-semibold text-text-2">{formatDuration(ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function LiveBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ice/15 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-ice">
      <Radio className="ambient-pulse size-2.5" />
      Live
    </span>
  );
}

function ArchivedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-strong px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.12em] text-text-3">
      <Archive className="size-2.5" />
      Archived
    </span>
  );
}

function ManualBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-volt/15 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-volt-hi">
      <PencilLine className="size-2.5" />
      Manual
    </span>
  );
}

function SessionDetail({
  session,
  dayStartMs,
  dayEndMs,
  nowMs,
  editHint,
  onEdit,
  onDelete,
  onClose,
}: {
  session: TimelineSession;
  dayStartMs: number;
  dayEndMs: number;
  nowMs: number;
  editHint: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { activity } = session;
  const Icon = ICON_REGISTRY[activity.iconKey].icon;
  const endMs = session.live ? Math.max(session.endMs, nowMs) : session.endMs;
  const totalMs = endMs - session.startMs;
  const onDayMs = session.dayEndMs - session.dayStartMs;
  const crossesDay = session.continuesFromPreviousDay || session.continuesIntoNextDay;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: DURATION.quick, ease: EASE_OUT }}
      className="relative mt-3 overflow-hidden rounded-[18px] border px-4 py-3.5"
      style={{
        borderColor: tint(activity.color, 0.35),
        background: `linear-gradient(135deg, ${tint(activity.color, 0.14)}, rgba(13,13,19,0.9) 70%)`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl"
            style={{ color: activity.color, background: tint(activity.color, 0.16) }}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-base font-semibold tracking-[-0.01em] text-text-1">
              <span className="truncate">{activity.name}</span>
              {session.live && <LiveBadge />}
              {session.manual && <ManualBadge />}
              {activity.archivedAtMs !== null && <ArchivedBadge />}
            </p>
            <p className="numeric text-xs text-text-3">{formatDuration(totalMs)} session</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close session details"
          className="-mr-1.5 -mt-1 grid size-9 shrink-0 place-items-center rounded-full text-text-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
        >
          <X className="size-4" />
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <DetailCell label="Start" value={formatMoment(session.startMs, dayStartMs, dayEndMs)} />
        <DetailCell label="End" value={session.live ? "Now" : formatMoment(session.endMs, dayStartMs, dayEndMs)} />
        <DetailCell label="Duration" value={formatDuration(totalMs)} />
      </dl>
      {crossesDay && (
        <p className="mt-2.5 text-xs text-text-3">
          Crosses midnight · <span className="numeric text-text-2">{formatDuration(onDayMs)}</span> on this day
        </p>
      )}
      {(onEdit || onDelete) && (
        <div className="mt-3 flex gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-ink-0/60 text-sm font-medium text-text-1 transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
            >
              <PencilLine className="size-4" />
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete session"
              className="grid size-11 shrink-0 place-items-center rounded-full border border-danger/35 text-[var(--danger-soft)] transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}
      {editHint && <p className="mt-2.5 text-xs text-text-3">{editHint}</p>}
    </motion.div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-[var(--wash)] px-2.5 py-2">
      <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-text-3">{label}</dt>
      <dd className="numeric mt-0.5 truncate text-[0.8rem] font-semibold text-text-1">{value}</dd>
    </div>
  );
}
