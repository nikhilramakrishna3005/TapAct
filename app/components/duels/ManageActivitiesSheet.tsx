"use client";

import { useState } from "react";
import { duelsApi, type DuelBoard, type DuelRuleActivity } from "@/lib/duels/api";
import {
  appendActivityDraft,
  canRemoveSharedActivity,
  draftWithoutActivity,
  removeActivityCopy,
  replaceActivityDraft,
} from "@/lib/duels/manage";
import { describeRuleChanges, type RuleChange } from "@/lib/duels/rules";
import { addActivity, createActivityId, type TrackerState } from "@/lib/tracker";
import type { TrackerUpdate } from "@/lib/trackerStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ConfirmSheet } from "./ConfirmSheet";
import { Sheet } from "../ui";

export function ManageActivitiesSheet({
  board,
  tracker,
  commit,
  busy,
  onAct,
  onClose,
}: {
  board: DuelBoard;
  tracker: TrackerState;
  commit: (update: TrackerUpdate) => void;
  busy: boolean;
  onAct: (work: () => Promise<void>, note?: string) => Promise<void>;
  onClose: () => void;
}) {
  const pending = board.duel.awaitingOpponent;
  const active = board.duel.status === "active" && !board.duel.final && !board.duel.awaitingOpponent;
  const canEdit = board.you.status === "active" && ((pending && board.you.creator !== false) || active);
  const needsApproval = active;
  const personal = tracker.activities.filter((activity) => activity.archivedAtMs === null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMinutes, setEditMinutes] = useState(20);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftMinutes, setDraftMinutes] = useState(20);
  const [draftTracker, setDraftTracker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const proposal = board.proposal ?? null;
  const changes = proposal ? describeRuleChanges(board.activities, proposal.activities) : [];
  const removeTarget = board.activities.find((activity) => activity.id === removeId);

  const submit = (next: DuelRuleActivity[], note: string) => {
    setError(null);
    void onAct(async () => {
      const client = getSupabaseBrowserClient();
      if (!client) return;
      if (needsApproval) await duelsApi.proposeRules(client, board.duel.id, next);
      else await duelsApi.setRules(client, board.duel.id, next);
    }, note);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const next = replaceActivityDraft(board.activities, editingId, { name: editName, targetMinutes: editMinutes });
    if (!next.ok) {
      setError(next.message);
      return;
    }
    if (describeRuleChanges(board.activities, next.next).length === 0) {
      setError("Nothing changed.");
      return;
    }
    submit(next.next, needsApproval ? "Proposed activity changes." : "Shared activities updated.");
    setEditingId(null);
  };

  const addShared = (name: string, targetMinutes: number, trackerActivityId: string | null) => {
    const next = appendActivityDraft(board.activities, { name, targetMinutes });
    if (!next.ok) {
      setError(next.message);
      return;
    }
    const payload = next.next.map((activity, index) =>
      index === next.next.length - 1 ? { ...activity, trackerActivityId: trackerActivityId ?? undefined } : activity,
    );
    submit(payload, needsApproval ? "Proposed a new shared activity." : "Shared activity added.");
    setAdding(false);
    setDraftName("");
    setDraftMinutes(20);
    setDraftTracker(null);
  };

  const createAndAdd = () => {
    const name = draftName.trim();
    if (name.length < 2) {
      setError("Name the activity before adding it.");
      return;
    }
    if (draftTracker) {
      addShared(name, draftMinutes, draftTracker);
      return;
    }
    const id = createActivityId(name);
    commit((base) => addActivity(base, { id, name, iconKey: "briefcase", color: "#8E7BFF", goalMinutes: draftMinutes, cue: "Duel activity" }));
    addShared(name, draftMinutes, id);
  };

  return (
    <>
    <Sheet label="Manage activities" onClose={onClose}>
      <p className="mt-3 text-xs leading-5 text-text-3">
        {pending
          ? "Changes update the invite immediately. Your Today activities keep their own names and goals."
          : "Your friend has to approve changes. Approved rules start on the next challenge day that has not begun for either of you. Earlier days keep their points."}
      </p>

      {proposal && <ProposalCard board={board} changes={changes} busy={busy} onAct={onAct} />}

      <ul className="mt-4 space-y-2">
        {board.activities.map((activity) => (
          <li key={activity.id} className="rounded-[18px] border border-line bg-ink-0 px-3 py-3">
            {editingId === activity.id ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={editName} maxLength={36} aria-label={`Shared name for ${activity.name}`} onChange={(event) => setEditName(event.target.value)} className="field" />
                  <input type="number" min={5} max={240} value={editMinutes} aria-label={`Daily target for ${activity.name}`} onChange={(event) => setEditMinutes(Number(event.target.value))} className="field numeric w-24" />
                </div>
                <p className="text-[0.7rem] text-text-3">Now {activity.name} · {activity.targetMinutes} min / day. Changing this does not rename your Today activity or change its goal.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost h-11 flex-1" onClick={() => setEditingId(null)}>Back</button>
                  <button type="button" disabled={busy || Boolean(proposal)} className="btn btn-primary h-11 flex-1" onClick={saveEdit}>
                    {needsApproval ? "Propose" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-1">{activity.name}</p>
                    <p className="text-xs text-text-3">{activity.targetMinutes} min / day</p>
                  </div>
                </div>
                {canEdit && !proposal && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="min-h-11 flex-1 rounded-full border border-line text-xs font-semibold text-volt-hi"
                      onClick={() => {
                        setEditingId(activity.id);
                        setEditName(activity.name);
                        setEditMinutes(activity.targetMinutes);
                        setError(null);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="min-h-11 flex-1 rounded-full border border-line text-xs font-semibold text-danger"
                      onClick={() => {
                        const allowed = canRemoveSharedActivity(board.activities.length);
                        if (!allowed.ok) {
                          setError(allowed.message);
                          return;
                        }
                        setRemoveId(activity.id);
                        setError(null);
                      }}
                    >
                      Remove from duel
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {canEdit && !proposal && !adding && board.activities.length < 3 && (
        <button type="button" disabled={busy} onClick={() => { setAdding(true); setError(null); }} className="btn btn-primary mt-4 h-12 w-full">
          Add activity
        </button>
      )}

      {adding && canEdit && !proposal && (
        <div className="mt-4 rounded-[18px] border border-line bg-ink-0 px-3 py-3">
          <p className="text-sm font-semibold text-text-1">Add activity</p>
          <p className="mt-1 text-xs text-text-3">Pick one of your Today activities or create a new one. A matching name is not selected for you. This will not add it to your friend's Today list.</p>
          <ul className="mt-2 max-h-40 overflow-y-auto">
            {personal.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={draftTracker === item.id}
                  className={`min-h-11 w-full rounded-xl px-2 text-left text-sm ${draftTracker === item.id ? "bg-volt/15 text-text-1" : "text-text-2 hover:bg-[var(--wash-strong)]"}`}
                  onClick={() => {
                    setDraftTracker(item.id);
                    setDraftName(item.name);
                    setDraftMinutes(item.goalMinutes ?? 20);
                    setError(null);
                  }}
                >
                  Use {item.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input value={draftName} maxLength={36} placeholder="Shared name" aria-label="New shared activity name" onChange={(event) => setDraftName(event.target.value)} className="field" />
            <input type="number" min={5} max={240} value={draftMinutes} aria-label="New shared daily minutes" onChange={(event) => setDraftMinutes(Number(event.target.value))} className="field numeric w-24" />
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-ghost h-11 flex-1" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" disabled={busy} className="btn btn-primary h-11 flex-1" onClick={createAndAdd}>
              {needsApproval ? "Propose" : "Add"}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    </Sheet>
    {removeTarget && (
      <ConfirmSheet
        {...removeActivityCopy(removeTarget.name, needsApproval)}
        busy={busy}
        onClose={() => setRemoveId(null)}
        onConfirm={() => {
          const next = draftWithoutActivity(board.activities, removeTarget.id);
          if (!next.ok) {
            setError(next.message);
            setRemoveId(null);
            return;
          }
          setRemoveId(null);
          submit(next.next, needsApproval ? "Proposed removing a shared activity." : "Shared activity removed from this duel.");
        }}
      />
    )}
    </>
  );
}

export function ProposalCard({
  board,
  changes,
  busy,
  onAct,
}: {
  board: DuelBoard;
  changes: RuleChange[];
  busy: boolean;
  onAct: (work: () => Promise<void>, note?: string) => Promise<void>;
}) {
  const proposal = board.proposal;
  if (!proposal) return null;
  return (
    <div className="mt-3 rounded-[18px] border border-volt/30 bg-volt/[0.06] px-3 py-3">
      <p className="text-sm font-semibold text-text-1">Pending request</p>
      <p className="mt-1 text-xs text-text-3">{proposal.mine ? "Waiting for your friend to approve." : "Your friend proposed these changes."}</p>
      <ul className="mt-2 space-y-1 text-sm text-text-1">
        {changes.length === 0 && <li>The proposed list matches the current rules.</li>}
        {changes.map((change) => (
          <li key={changeKey(change)}>{changeLabel(change)}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-5 text-text-3">If approved, the new rules start on the next challenge day that has not begun for either of you. Days already started keep their current points.</p>
      <div className="mt-3 flex gap-2">
        {proposal.mine ? (
          <button
            type="button"
            disabled={busy}
            className="btn btn-ghost h-11 flex-1"
            onClick={() => {
              void onAct(async () => {
                const client = getSupabaseBrowserClient();
                if (!client) return;
                await duelsApi.withdrawProposal(client, proposal.id);
              }, "Proposal withdrawn.");
            }}
          >
            Withdraw
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              className="btn btn-ghost h-11 flex-1"
              onClick={() => {
                void onAct(async () => {
                  const client = getSupabaseBrowserClient();
                  if (!client) return;
                  await duelsApi.rejectProposal(client, proposal.id);
                }, "Proposal rejected.");
              }}
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn btn-primary h-11 flex-1"
              onClick={() => {
                void onAct(async () => {
                  const client = getSupabaseBrowserClient();
                  if (!client) return;
                  await duelsApi.approveProposal(client, proposal.id);
                }, "Proposal approved.");
              }}
            >
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function changeLabel(change: RuleChange): string {
  if (change.kind === "add") return `Add ${change.name} · ${change.targetMinutes} min / day`;
  if (change.kind === "remove") return `Remove ${change.name} from the duel`;
  if (change.kind === "rename") return `Rename ${change.from} to ${change.to}`;
  return `Change ${change.name} from ${change.from} to ${change.to} min / day`;
}

function changeKey(change: RuleChange): string {
  if (change.kind === "add") return `add:${change.name}:${change.targetMinutes}`;
  if (change.kind === "remove") return `remove:${change.name}`;
  if (change.kind === "rename") return `rename:${change.from}:${change.to}`;
  return `target:${change.name}:${change.from}:${change.to}`;
}
