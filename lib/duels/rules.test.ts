import { describe, expect, it } from "vitest";
import { applyPendingRuleEdit, describeRuleChanges, reviewRuleProposal, type StoredRuleActivity } from "./rules";

const existing: StoredRuleActivity[] = [
  { id: "read", name: "Read", targetMinutes: 20 },
  { id: "move", name: "Workout", targetMinutes: 30 },
];

function edit(next: { id?: string; name: string; targetMinutes: number }[], patch?: { viewerId?: string | null; status?: "pending" | "active" | "completed" | "cancelled" }) {
  const ids = ["added-1", "added-2"];
  return applyPendingRuleEdit({
    viewerId: patch && "viewerId" in patch ? patch.viewerId ?? null : "creator",
    creatorId: "creator",
    status: patch?.status ?? "pending",
    existing,
    next,
    newId: () => ids.shift() ?? "added",
  });
}

describe("collaborative rule changes", () => {
  const current = [
    { id: "read", name: "Read", targetMinutes: 20 },
    { id: "move", name: "Workout", targetMinutes: 30 },
  ];

  it("describes adds, renames, target changes, and removals without touching the old list", () => {
    expect(describeRuleChanges(current, [
      { id: "move", name: "Lift", targetMinutes: 45 },
      { name: "Code", targetMinutes: 60 },
    ])).toEqual([
      { kind: "rename", from: "Workout", to: "Lift" },
      { kind: "target", name: "Lift", from: 30, to: 45 },
      { kind: "add", name: "Code", targetMinutes: 60 },
      { kind: "remove", name: "Read" },
    ]);
    expect(current[0].name).toBe("Read");
  });

  it("requires the other active player and ignores a stale or finished proposal", () => {
    const base = {
      viewerId: "friend",
      proposerId: "creator",
      memberIds: ["creator", "friend"],
      duelStatus: "active" as const,
      proposalStatus: "pending" as const,
      baseVersion: 1,
      currentVersion: 1,
      action: "approve" as const,
    };
    expect(reviewRuleProposal(base)).toEqual({ ok: true });
    expect(reviewRuleProposal({ ...base, viewerId: "creator", action: "approve" }).ok).toBe(false);
    expect(reviewRuleProposal({ ...base, viewerId: "outsider" }).ok).toBe(false);
    expect(reviewRuleProposal({ ...base, duelStatus: "completed" }).ok).toBe(false);
    expect(reviewRuleProposal({ ...base, duelStatus: "pending" }).ok).toBe(false);
    expect(reviewRuleProposal({ ...base, currentVersion: 2 }).ok).toBe(false);
    expect(reviewRuleProposal({ ...base, proposalStatus: "approved" }).ok).toBe(false);
    expect(reviewRuleProposal({ ...base, viewerId: "creator", action: "withdraw" })).toEqual({ ok: true });
    expect(reviewRuleProposal({ ...base, action: "reject" })).toEqual({ ok: true });
  });
});

describe("pending duel rule edits", () => {
  it("renames, reorders, adds, and removes while keeping existing names and ids", () => {
    const renamed = edit([
      { id: "move", name: "  Lift  ", targetMinutes: 45 },
      { id: "read", name: "Read", targetMinutes: 20 },
      { name: "Code", targetMinutes: 60 },
    ]);
    expect(renamed).toEqual({
      ok: true,
      activities: [
        { id: "move", name: "Lift", targetMinutes: 45 },
        { id: "read", name: "Read", targetMinutes: 20 },
        { id: "added-1", name: "Code", targetMinutes: 60 },
      ],
    });

    const removed = edit([{ id: "read", name: "Read", targetMinutes: 20 }]);
    expect(removed).toEqual({ ok: true, activities: [{ id: "read", name: "Read", targetMinutes: 20 }] });
  });

  it("rejects the invited friend and any edit after acceptance", () => {
    const next = [{ id: "read", name: "Changed", targetMinutes: 20 }];
    expect(edit(next, { viewerId: "friend" })).toMatchObject({ ok: false });
    expect(edit(next, { viewerId: null })).toMatchObject({ ok: false, message: expect.stringMatching(/Sign in/) });
    for (const status of ["active", "completed", "cancelled"] as const) {
      expect(edit(next, { status })).toMatchObject({ ok: false, message: expect.stringMatching(/before your friend accepts/) });
    }
  });
});
