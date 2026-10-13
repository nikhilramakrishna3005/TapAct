"use client";

import { type FormEvent, useState } from "react";
import { deviceTimeZone, deviceTodayKey, duelError, shareInvite } from "@/lib/duels/api";
import { suggestDuelTitle, validateDuelDraft, type DuelActivityDraft } from "@/lib/duels/invite";
import { DUEL_DURATIONS, type DuelDuration } from "@/lib/duels/score";
import { addActivity, createActivityId, type Activity, type TrackerState } from "@/lib/tracker";
import type { TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { duelsApi } from "@/lib/duels/api";
import { Sheet } from "../ui";

type Step = "setup" | "confirm" | "link";

export function CreateDuelSheet({
  tracker,
  commit,
  onClose,
  onCreated,
}: {
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = deviceTodayKey();
  const [step, setStep] = useState<Step>("setup");
  const [durationDays, setDurationDays] = useState<DuelDuration>(7);
  const [startsOn, setStartsOn] = useState(today);
  const [title, setTitle] = useState("");
  const [activities, setActivities] = useState<DuelActivityDraft[]>([]);
  const [freshName, setFreshName] = useState("");
  const [freshMinutes, setFreshMinutes] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const resolvedTitle = title.trim() || suggestDuelTitle(durationDays, activities[0]?.name ?? "");
  const activeActivities = tracker.activities.filter((activity) => activity.archivedAtMs === null);

  const updateActivity = (index: number, patch: Partial<DuelActivityDraft>) => {
    setActivities((current) => current.map((activity, i) => (i === index ? { ...activity, ...patch } : activity)));
  };

  const toggleExisting = (activity: Activity) => {
    const already = activities.some((item) => item.trackerActivityId === activity.id);
    if (!already && activities.length >= 3) {
      setError("A duel can include up to 3 activities.");
      return;
    }
    setActivities((current) => {
      if (current.some((item) => item.trackerActivityId === activity.id)) {
        return current.filter((item) => item.trackerActivityId !== activity.id);
      }
      return [...current, { name: activity.name, targetMinutes: activity.goalMinutes ?? 20, trackerActivityId: activity.id }];
    });
    setError(null);
  };

  const createAndSelect = () => {
    const name = freshName.trim();
    if (name.length < 2) {
      setError("Name the activity before adding it to Today.");
      return;
    }
    if (activities.length >= 3) {
      setError("A duel can include up to 3 activities.");
      return;
    }
    const match = activeActivities.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
    if (match) {
      if (!activities.some((item) => item.trackerActivityId === match.id)) {
        setActivities((current) => [...current, { name: match.name, targetMinutes: freshMinutes, trackerActivityId: match.id }]);
      }
      setFreshName("");
      setError(null);
      return;
    }
    const id = createActivityId(name);
    commit((base) => addActivity(base, { id, name, iconKey: "briefcase", color: "#8E7BFF", goalMinutes: freshMinutes, cue: "Duel activity" }));
    setActivities((current) => [...current, { name, targetMinutes: freshMinutes, trackerActivityId: id }]);
    setFreshName("");
    setError(null);
  };

  const goConfirm = (event: FormEvent) => {
    event.preventDefault();
    const result = validateDuelDraft(
      { title: resolvedTitle, durationDays, startsOn, timeZone: deviceTimeZone(), activities },
      today,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setStep("confirm");
  };

  const create = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const created = await duelsApi.create(client, {
        title: resolvedTitle,
        durationDays,
        startsOn,
        timeZone: deviceTimeZone(),
        activities,
      });
      setToken(created.token);
      setStep("link");
      onCreated();
    } catch (caught) {
      setError(duelError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label={step === "link" ? "Invite ready" : "Create duel"} onClose={onClose}>
      {step === "setup" && (
        <form className="mt-4 space-y-4" onSubmit={goConfirm}>
          <fieldset>
            <legend className="eyebrow mb-2">Length</legend>
            <div className="grid grid-cols-3 gap-2">
              {DUEL_DURATIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={durationDays === days}
                  onClick={() => setDurationDays(days)}
                  className={`min-h-11 rounded-full border text-sm font-semibold ${durationDays === days ? "border-volt bg-volt/15 text-text-1" : "border-line text-text-2"}`}
                >
                  {days} days
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Start date</span>
            <input type="date" required min={today} value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="field numeric [color-scheme:dark]" />
          </label>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={48} placeholder={suggestDuelTitle(durationDays, activities[0]?.name ?? "")} className="field" />
          </label>
          <div>
            <p className="eyebrow mb-2">From Today</p>
            {activeActivities.length === 0 && <p className="text-xs text-text-3">No activities on Today yet. Add one below.</p>}
            <ul className="space-y-1">
              {activeActivities.map((item) => {
                const selected = activities.some((activity) => activity.trackerActivityId === item.id);
                return (
                  <li key={item.id}>
                    <button type="button" aria-pressed={selected} onClick={() => toggleExisting(item)} className={`min-h-11 w-full rounded-xl border px-3 text-left text-sm ${selected ? "border-volt/50 text-text-1" : "border-line text-text-2"}`}>
                      {selected ? "Selected" : "Select"} · {item.name}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex gap-2">
              <input value={freshName} onChange={(event) => setFreshName(event.target.value)} maxLength={36} placeholder="New activity" aria-label="New activity name" className="field" />
              <input type="number" min={5} max={240} value={freshMinutes} onChange={(event) => setFreshMinutes(Number(event.target.value))} aria-label="New activity daily minutes" className="field numeric w-24" />
            </div>
            <button type="button" onClick={createAndSelect} className="mt-2 text-sm font-medium text-volt-hi">Add to Today and this duel</button>
          </div>
          <div className="space-y-2">
            <p className="eyebrow">In this duel</p>
            {activities.length === 0 && <p className="text-xs text-text-3">Choose at least one activity.</p>}
            <p className="text-xs text-text-3">These names and daily targets are for the duel. Your Today activities keep their own names and goals.</p>
            {activities.map((activity, index) => (
              <div key={activity.trackerActivityId ?? index} className="rounded-[16px] border border-line bg-ink-0 px-3 py-3">
                <div className="flex gap-2">
                  <input value={activity.name} onChange={(event) => updateActivity(index, { name: event.target.value })} maxLength={36} aria-label={`Shared name ${index + 1}`} className="field" />
                  <input type="number" min={5} max={240} value={activity.targetMinutes} onChange={(event) => updateActivity(index, { targetMinutes: Number(event.target.value) })} aria-label={`Daily minutes ${index + 1}`} className="field numeric w-24" />
                </div>
                <button type="button" onClick={() => setActivities((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="mt-2 text-xs font-medium text-text-3">
                  Remove from duel
                </button>
              </div>
            ))}
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button type="submit" className="btn btn-primary h-12 w-full">Review rules</button>
        </form>
      )}

      {step === "confirm" && (
        <div className="mt-4 space-y-3 text-sm text-text-2">
          <p className="text-base font-semibold text-text-1">{resolvedTitle}</p>
          <p>{durationDays} days starting {startsOn}. 20 points per daily target, plus 10 if you hit every target that day. Extra time past a target does not add points.</p>
          <ul className="space-y-1">
            {activities.map((activity) => (
              <li key={activity.name}>{activity.name}: {activity.targetMinutes} min / day</li>
            ))}
          </ul>
          <p>Only timer-recorded time counts. Sessions you add or edit by hand stay in History and do not score. Days stay in {deviceTimeZone()}, even if your phone time zone changes. Nothing before the start date counts. If your friend accepts after that date has started in either time zone, you both move to the next full day, and earlier tracking does not score.</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setStep("setup")} className="btn btn-ghost h-12 flex-1">Back</button>
            <button type="button" disabled={busy} onClick={() => void create()} className="btn btn-primary h-12 flex-1">{busy ? "Creating…" : "Create duel"}</button>
          </div>
        </div>
      )}

      {step === "link" && token && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-text-2">Send this private link to one friend. It expires in 7 days and can only be accepted once.</p>
          <p className="break-all rounded-[14px] border border-line bg-ink-0 px-3 py-3 text-xs text-text-1">{invitePath(token)}</p>
          {shareNote && <p className="text-xs text-mint">{shareNote}</p>}
          <button
            type="button"
            className="btn btn-primary h-12 w-full"
            onClick={() => {
              void shareInvite(token, resolvedTitle).then((result) => setShareNote(result === "copied" ? "Link copied." : "Invite shared.")).catch(() => setShareNote("Couldn't share the link."));
            }}
          >
            Share invite
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost h-12 w-full">Done</button>
        </div>
      )}
    </Sheet>
  );
}

function invitePath(token: string): string {
  if (typeof window === "undefined") return `/duel/${token}`;
  return `${window.location.origin}/duel/${token}`;
}
