"use client";

import { AlertTriangle, Moon, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { TimeEntry } from "@/lib/sync/merge";
import {
  getRunningTimer,
  type RescueResult,
  type SessionChange,
  type SessionDraft,
  validateSessionDraft,
} from "@/lib/sync/rescue";
import { getDayBounds, type TimelineSession } from "@/lib/timeline";
import { getDayKeyForMs, type TrackerState } from "@/lib/tracker";
import { formatSummaryDuration, ICON_REGISTRY, Sheet, tint } from "./ui";

const MINUTE = 60_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalInput(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : Number.NaN;
}

export function formatSessionTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatSessionRange(startMs: number, endMs: number): string {
  const sameDay = getDayKeyForMs(startMs) === getDayKeyForMs(endMs);
  const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return sameDay
    ? `${day(startMs)}, ${formatSessionTime(startMs)} – ${formatSessionTime(endMs)}`
    : `${day(startMs)}, ${formatSessionTime(startMs)} – ${day(endMs)}, ${formatSessionTime(endMs)}`;
}

function defaultDraft(dayKey: string, nowMs: number, activityId: string): SessionDraft {
  const { startMs: dayStart, endMs: dayEnd } = getDayBounds(dayKey);
  if (nowMs >= dayStart && nowMs < dayEnd) {
    const endMs = Math.floor(nowMs / (5 * MINUTE)) * 5 * MINUTE;
    return { activityId, startMs: Math.max(dayStart, endMs - 30 * MINUTE), endMs };
  }
  const noon = new Date(dayStart);
  noon.setHours(12, 0, 0, 0);
  return { activityId, startMs: noon.getTime(), endMs: noon.getTime() + 30 * MINUTE };
}

type EditorProps = {
  session: TimelineSession | null;
  dayKey: string;
  tracker: TrackerState;
  entries: TimeEntry[];
  nowMs: number;
  /** Time recorded on this day as totals only. */
  untimedMs: number;
  onSubmit: (change: SessionChange) => RescueResult;
  onDelete: () => void;
  onClose: () => void;
};

export function SessionEditorSheet({
  session,
  dayKey,
  tracker,
  entries,
  nowMs,
  untimedMs,
  onSubmit,
  onDelete,
  onClose,
}: EditorProps) {
  const activities = useMemo(
    () => tracker.activities.filter((activity) => activity.archivedAtMs === null || activity.id === session?.activity.id),
    [session?.activity.id, tracker.activities],
  );
  const [initial] = useState<SessionDraft>(() =>
    session
      ? { activityId: session.activity.id, startMs: session.startMs, endMs: session.endMs }
      : defaultDraft(dayKey, nowMs, activities[0]?.id ?? ""),
  );
  const [activityId, setActivityId] = useState(initial.activityId);
  const [startValue, setStartValue] = useState(toLocalInput(initial.startMs));
  const [endValue, setEndValue] = useState(toLocalInput(initial.endMs));
  const [submitProblem, setSubmitProblem] = useState<string | null>(null);

  const startUntouched = startValue === toLocalInput(initial.startMs);
  const endUntouched = endValue === toLocalInput(initial.endMs);
  const draft: SessionDraft = {
    activityId,
    startMs: startUntouched ? initial.startMs : fromLocalInput(startValue),
    endMs: endUntouched ? initial.endMs : fromLocalInput(endValue),
  };
  const replaceIds = session?.entryIds ?? [];
  const unchanged = session !== null && activityId === initial.activityId && startUntouched && endUntouched;

  const problem = validateSessionDraft(draft, {
    entries,
    replaceIds,
    running: getRunningTimer(tracker),
    activities: tracker.activities,
    nowMs,
    originalActivityId: session?.activity.id,
  });
  const conflictActivity = problem?.conflict
    ? tracker.activities.find((activity) => activity.id === problem.conflict?.activityId)
    : undefined;
  const problemText = problem
    ? problem.conflict
      ? `${problem.message} ${conflictActivity?.name ?? "A session"} runs ${formatSessionRange(problem.conflict.startMs, problem.conflict.endMs)}.`
      : problem.message
    : null;
  const validDuration = Number.isFinite(draft.startMs) && Number.isFinite(draft.endMs) && draft.endMs > draft.startMs;
  const crossesMidnight = validDuration && getDayKeyForMs(draft.startMs) !== getDayKeyForMs(draft.endMs - 1);
  const maxValue = toLocalInput(nowMs);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (problem || unchanged) return;
    const result = onSubmit({ kind: "save", replaceIds, draft });
    if (result.ok) {
      onClose();
    } else {
      setSubmitProblem(result.problem.message);
    }
  };

  const label = session ? "Edit session" : "Add session";

  return (
    <Sheet label={label} onClose={onClose}>
      <form className="mt-4 space-y-5" onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend className="eyebrow mb-2">Activity</legend>
          <div className="grid grid-cols-2 gap-2">
            {activities.map((activity) => {
              const Icon = ICON_REGISTRY[activity.iconKey].icon;
              const selected = activity.id === activityId;
              return (
                <button
                  key={activity.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActivityId(activity.id)}
                  className="flex min-h-12 items-center gap-2.5 rounded-[14px] border px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
                  style={{
                    borderColor: selected ? activity.color : "var(--line)",
                    background: selected ? tint(activity.color, 0.14) : "var(--ink-0)",
                    color: selected ? "var(--text-1)" : "var(--text-2)",
                  }}
                >
                  <Icon className="size-4 shrink-0" style={{ color: activity.color }} />
                  <span className="truncate">{activity.name}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3">
          <label className="block">
            <span className="eyebrow mb-1.5 block">Start</span>
            <input
              type="datetime-local"
              step={60}
              max={maxValue}
              value={startValue}
              onChange={(event) => {
                setStartValue(event.target.value);
                setSubmitProblem(null);
              }}
              className="field numeric [color-scheme:dark]"
              required
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1.5 block">End</span>
            <input
              type="datetime-local"
              step={60}
              max={maxValue}
              value={endValue}
              onChange={(event) => {
                setEndValue(event.target.value);
                setSubmitProblem(null);
              }}
              className="field numeric [color-scheme:dark]"
              required
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
          <span className="numeric rounded-full border border-line-strong px-2.5 py-1 font-semibold text-text-1">
            {validDuration ? formatSummaryDuration(draft.endMs - draft.startMs) : "—"}
          </span>
          {crossesMidnight && (
            <span className="inline-flex items-center gap-1 rounded-full bg-volt/15 px-2.5 py-1 font-medium text-volt-hi">
              <Moon className="size-3" />
              Crosses midnight
            </span>
          )}
        </div>

        {!session && untimedMs > 0 && (
          <p className="flex items-start gap-2 rounded-[14px] border border-ember/25 bg-ember/[0.06] px-3 py-2.5 text-xs leading-relaxed text-text-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-ember" />
            This day also has {formatSummaryDuration(untimedMs)} recorded as totals only. Make sure this session
            isn&apos;t already part of it.
          </p>
        )}

        {(problemText || submitProblem) && !unchanged && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {submitProblem ?? problemText}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-ghost h-12 flex-1">
            Cancel
          </button>
          <button type="submit" disabled={problem !== null || unchanged} className="btn btn-primary h-12 flex-1">
            {session ? "Save changes" : "Add session"}
          </button>
        </div>

        {session && (
          <button
            type="button"
            onClick={onDelete}
            className="mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-[var(--danger-soft)] transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <Trash2 className="size-4" />
            Delete session
          </button>
        )}
      </form>
    </Sheet>
  );
}

export function DeleteSessionSheet({
  session,
  onConfirm,
  onClose,
}: {
  session: TimelineSession;
  onConfirm: () => RescueResult;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const { activity } = session;
  return (
    <Sheet label="Delete session?" onClose={onClose}>
      <div className="mt-4 rounded-[16px] border px-4 py-3" style={{ borderColor: tint(activity.color, 0.35), background: tint(activity.color, 0.08) }}>
        <p className="text-sm font-semibold text-text-1">{activity.name}</p>
        <p className="numeric mt-0.5 text-xs text-text-2">
          {formatSessionRange(session.startMs, session.endMs)} · {formatSummaryDuration(session.endMs - session.startMs)}
        </p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-text-2">
        This time is removed from your totals on all your signed-in devices.
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {problem}
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className="btn btn-ghost h-12 flex-1">
          Keep session
        </button>
        <button
          type="button"
          onClick={() => {
            const result = onConfirm();
            if (result.ok) onClose();
            else setProblem(result.problem.message);
          }}
          className="btn h-12 flex-1 border border-danger/40 bg-danger/15 text-[var(--danger-ink)] hover:bg-danger/25"
        >
          <Trash2 className="size-4" />
          Delete
        </button>
      </div>
    </Sheet>
  );
}
