import { describe, expect, it } from "vitest";
import type { DuelListItem } from "./api";
import {
  alreadyResolvedDuelAction,
  appendActivityDraft,
  archivedDuelAction,
  archivedDuelLabel,
  canArchiveDuel,
  canRemoveSharedActivity,
  canRestoreDuel,
  draftWithoutActivity,
  duelActionCopy,
  duelMenuAction,
  isArchivedDuel,
  isMainListDuel,
  partitionDuelLists,
  removeActivityCopy,
  replaceActivityDraft,
  reviewArchiveRequest,
} from "./manage";

function item(partial: Partial<DuelListItem> & Pick<DuelListItem, "id" | "status">): DuelListItem {
  return {
    title: "Focus week",
    startsOn: "2026-10-13",
    durationDays: 7,
    awaitingOpponent: partial.status === "pending",
    archived: false,
    creator: true,
    memberStatus: "active",
    ...partial,
  };
}

const current = [
  { id: "read", name: "Read", targetMinutes: 20 },
  { id: "move", name: "Workout", targetMinutes: 30 },
];

describe("duel list management", () => {
  it("keeps pending, active, and completed duels on the main list until archived", () => {
    const pending = item({ id: "p", status: "pending" });
    const active = item({ id: "a", status: "active" });
    const done = item({ id: "c", status: "completed" });
    const hidden = item({ id: "h", status: "completed", archived: true });
    const cancelled = item({ id: "x", status: "cancelled" });
    expect(isMainListDuel(pending)).toBe(true);
    expect(isMainListDuel(active)).toBe(true);
    expect(isMainListDuel(done)).toBe(true);
    expect(isMainListDuel(hidden)).toBe(false);
    expect(isMainListDuel(cancelled)).toBe(false);
    expect(isArchivedDuel(cancelled)).toBe(true);
    expect(isArchivedDuel(hidden)).toBe(true);
    expect(partitionDuelLists([pending, hidden, cancelled]).main.map((row) => row.id)).toEqual(["p"]);
    expect(partitionDuelLists([pending, hidden, cancelled]).archived.map((row) => row.id)).toEqual(["h", "x"]);
  });

  it("offers cancel, leave, archive, and restore as distinct actions", () => {
    expect(duelMenuAction(item({ id: "p", status: "pending", creator: true }))).toBe("cancel");
    expect(duelMenuAction(item({ id: "p", status: "pending", creator: false }))).toBeNull();
    expect(duelMenuAction(item({ id: "a", status: "active" }))).toBe("leave");
    expect(duelMenuAction(item({ id: "a", status: "active", memberStatus: "left" }))).toBe("archive");
    expect(duelMenuAction(item({ id: "c", status: "completed" }))).toBe("archive");
    expect(duelMenuAction(item({ id: "x", status: "cancelled" }))).toBe("archive");
    expect(duelMenuAction(item({ id: "h", status: "completed", archived: true }))).toBeNull();
    expect(canRestoreDuel(item({ id: "h", status: "completed", archived: true }))).toBe(true);
    expect(canRestoreDuel(item({ id: "x", status: "cancelled", archived: true }))).toBe(true);
    expect(canRestoreDuel(item({ id: "c", status: "completed" }))).toBe(false);
    expect(archivedDuelAction(item({ id: "x", status: "cancelled" }))).toBe("archive");
    expect(archivedDuelAction(item({ id: "x", status: "cancelled", archived: true }))).toBe("restore");
    expect(archivedDuelAction(item({ id: "h", status: "completed", archived: true }))).toBe("restore");
    expect(duelActionCopy("cancel", "Focus week").confirmLabel).toBe("Cancel duel");
    expect(duelActionCopy("leave", "Focus week").body).toMatch(/live activity status/);
    expect(duelActionCopy("archive", "Focus week").body).toMatch(/only for you/);
    expect(duelActionCopy("cancel", "Focus week").body).not.toMatch(/Leave duel/);
  });

  it("lets a member who already left an active duel archive and later restore it", () => {
    const left = item({ id: "left", status: "active", memberStatus: "left" });
    const hidden = item({ id: "left", status: "active", memberStatus: "left", archived: true });
    expect(canArchiveDuel(left)).toBe(true);
    expect(canArchiveDuel(item({ id: "a", status: "active" }))).toBe(false);
    expect(duelMenuAction(left)).toBe("archive");
    expect(isMainListDuel(left)).toBe(true);
    expect(isMainListDuel(hidden)).toBe(false);
    expect(isArchivedDuel(hidden)).toBe(true);
    expect(archivedDuelAction(hidden)).toBe("restore");
    expect(archivedDuelLabel(left)).toBe("Left");
    expect(canRestoreDuel(hidden)).toBe(true);
    expect(partitionDuelLists([left, hidden]).main.map((row) => row.id)).toEqual(["left"]);
    expect(partitionDuelLists([left, hidden]).archived.map((row) => row.id)).toEqual(["left"]);
    expect(reviewArchiveRequest({
      viewerId: "you",
      memberUserId: "you",
      memberStatus: "left",
      duelStatus: "active",
    })).toEqual({ ok: true });
    expect(reviewArchiveRequest({
      viewerId: "you",
      memberUserId: "you",
      memberStatus: "active",
      duelStatus: "active",
    }).ok).toBe(false);
    expect(reviewArchiveRequest({
      viewerId: "you",
      memberUserId: "friend",
      memberStatus: "left",
      duelStatus: "active",
    }).ok).toBe(false);
    expect(reviewArchiveRequest({
      viewerId: "you",
      memberUserId: "you",
      memberStatus: "left",
      duelStatus: "completed",
    })).toEqual({ ok: true });
  });
});

describe("shared activity drafts", () => {
  it("blocks removing the last shared activity and keeps remaining ids stable", () => {
    expect(canRemoveSharedActivity(1)).toMatchObject({ ok: false, message: expect.stringMatching(/at least one/) });
    expect(draftWithoutActivity([{ id: "read", name: "Read", targetMinutes: 20 }], "read")).toMatchObject({ ok: false });
    expect(draftWithoutActivity(current, "read")).toEqual({
      ok: true,
      next: [{ id: "move", name: "Workout", targetMinutes: 30 }],
    });
    expect(replaceActivityDraft(current, "move", { name: "Lift", targetMinutes: 45 })).toEqual({
      ok: true,
      next: [
        { id: "read", name: "Read", targetMinutes: 20 },
        { id: "move", name: "Lift", targetMinutes: 45 },
      ],
    });
    expect(appendActivityDraft(current, { name: "Code", targetMinutes: 60 })).toEqual({
      ok: true,
      next: [
        { id: "read", name: "Read", targetMinutes: 20 },
        { id: "move", name: "Workout", targetMinutes: 30 },
        { name: "Code", targetMinutes: 60 },
      ],
    });
    expect(appendActivityDraft([...current, { id: "code", name: "Code", targetMinutes: 60 }], { name: "Write", targetMinutes: 20 })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/up to 3/),
    });
  });

  it("names the activity being removed and never calls the action delete", () => {
    const pending = removeActivityCopy("Coding", false);
    const active = removeActivityCopy("Coding", true);
    expect(pending.confirmLabel).toBe("Remove from duel");
    expect(active.confirmLabel).toBe("Propose removal");
    expect(pending.body).toMatch(/"Coding"/);
    expect(active.body).toMatch(/friend has to approve/);
    expect(`${pending.title} ${pending.body} ${active.title} ${active.body}`).not.toMatch(/delete activity/i);
  });

  it("treats repeated cancel, leave, and archive errors as already resolved", () => {
    expect(alreadyResolvedDuelAction("Only an open invite can be revoked.")).toBe(true);
    expect(alreadyResolvedDuelAction("You are not in this duel.")).toBe(true);
    expect(alreadyResolvedDuelAction("This duel is already finished.")).toBe(true);
    expect(alreadyResolvedDuelAction("This duel is already out of your list.")).toBe(true);
    expect(alreadyResolvedDuelAction("Couldn't reach duels.")).toBe(false);
  });
});
