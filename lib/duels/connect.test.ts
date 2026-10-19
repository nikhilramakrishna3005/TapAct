import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeNameMatches,
  claimLinkAttempt,
  decideDuelActivityLink,
  trackerCommitPersisted,
  type ConnectableActivity,
} from "./connect";

const coding = (patch: Partial<ConnectableActivity> = {}): ConnectableActivity => ({
  id: "coding",
  name: "Coding",
  archivedAtMs: null,
  goalMinutes: 60,
  ...patch,
});

describe("duel activity matching", () => {
  it("matches an exact name without changing the existing activity", () => {
    const existing = coding();
    const matches = activeNameMatches([existing], "Coding");
    expect(matches).toEqual([existing]);
    expect(existing).toEqual({ id: "coding", name: "Coding", archivedAtMs: null, goalMinutes: 60 });
    expect(decideDuelActivityLink({ duelName: "Coding", mappedTrackerId: null, activities: [existing] })).toEqual({
      action: "link",
      trackerActivityId: "coding",
    });
  });

  it("matches different capitalization and surrounding or repeated whitespace", () => {
    const existing = coding({ name: "Coding" });
    expect(activeNameMatches([existing], "  coding  ").map((item) => item.id)).toEqual(["coding"]);
    expect(activeNameMatches([existing], "CODING").map((item) => item.id)).toEqual(["coding"]);
    expect(activeNameMatches([coding({ name: "Deep   work" })], " deep work ").map((item) => item.id)).toEqual(["coding"]);
    expect(activeNameMatches([existing], "Co ding")).toEqual([]);
  });

  it("asks for a choice when several active activities match and does not pick one", () => {
    const activities = [coding({ id: "a", name: "Coding" }), coding({ id: "b", name: " coding " })];
    const decision = decideDuelActivityLink({ duelName: "Coding", mappedTrackerId: null, activities });
    expect(decision).toEqual({ action: "choose", matches: activities });
  });

  it("does not create a dashboard activity when nothing on Today matches", () => {
    expect(
      decideDuelActivityLink({
        duelName: "Reading",
        mappedTrackerId: null,
        activities: [coding()],
      }),
    ).toEqual({ action: "needs-activity" });
  });

  it("ignores an archived activity with the same name", () => {
    const archived = coding({ archivedAtMs: 10 });
    expect(activeNameMatches([archived], "Coding")).toEqual([]);
    expect(
      decideDuelActivityLink({ duelName: "Coding", mappedTrackerId: null, activities: [archived] }),
    ).toEqual({ action: "needs-activity" });
    expect(
      decideDuelActivityLink({
        duelName: "Coding",
        mappedTrackerId: archived.id,
        activities: [archived],
      }),
    ).toEqual({ action: "needs-activity" });
  });

  it("keeps an existing valid mapping and does not remap from the name", () => {
    const activities = [coding(), coding({ id: "gym", name: "Gym", goalMinutes: 30 })];
    expect(
      decideDuelActivityLink({ duelName: "Coding", mappedTrackerId: "coding", activities }),
    ).toEqual({ action: "connected", trackerActivityId: "coding" });
    expect(
      decideDuelActivityLink({
        duelName: "Coding",
        mappedTrackerId: "coding",
        activities,
        selectedTrackerId: "coding",
      }),
    ).toEqual({ action: "connected", trackerActivityId: "coding" });
  });

  it("links an intentional selection without guessing a same-name activity", () => {
    const activities = [coding(), coding({ id: "gym", name: "Gym", goalMinutes: 30 })];
    expect(
      decideDuelActivityLink({
        duelName: "Coding",
        mappedTrackerId: null,
        activities,
        selectedTrackerId: "gym",
      }),
    ).toEqual({ action: "link", trackerActivityId: "gym" });
  });

  it("retries a saved activity by linking it instead of creating another", () => {
    const created = coding({ id: "coding-ab12", name: "Reading", goalMinutes: 20 });
    expect(
      decideDuelActivityLink({
        duelName: "Reading",
        mappedTrackerId: null,
        activities: [created],
        selectedTrackerId: created.id,
      }),
    ).toEqual({ action: "link", trackerActivityId: "coding-ab12" });
  });

  it("ignores a second tap while a link attempt is in progress", () => {
    const lock = { current: false };
    expect(claimLinkAttempt(lock)).toBe(true);
    expect(claimLinkAttempt(lock)).toBe(false);
    expect(lock.current).toBe(true);
    lock.current = false;
    expect(claimLinkAttempt(lock)).toBe(true);
  });

  it("treats a tracker write as successful only when it was persisted", () => {
    expect(trackerCommitPersisted({ persisted: true })).toBe(true);
    expect(trackerCommitPersisted({ persisted: false })).toBe(false);
    expect(trackerCommitPersisted(undefined)).toBe(false);
    expect(trackerCommitPersisted(null)).toBe(false);
  });

  it("links an existing Today activity and does not create one from a duel", () => {
    const arena = readFileSync(resolve(process.cwd(), "app/components/duels/DuelArena.tsx"), "utf8");
    const create = readFileSync(resolve(process.cwd(), "app/components/duels/CreateDuelSheet.tsx"), "utf8");
    const manage = readFileSync(resolve(process.cwd(), "app/components/duels/ManageActivitiesSheet.tsx"), "utf8");
    for (const source of [arena, create, manage]) {
      expect(source).not.toContain("addActivity");
      expect(source).not.toContain("createActivityId");
      expect(source).not.toContain("Create new activity");
      expect(source).not.toContain("Add to Today and this duel");
    }
    expect(arena).toContain("claimLinkAttempt(linking)");
    expect(arena).toContain("Use existing activity");
    expect(arena).toContain("Connected to");
    expect(arena).toContain("linkExisting");
    expect(arena).toContain("planJoinLink");
    expect(arena).not.toContain("Add to my activities");
    expect(arena).not.toContain("updateActivity");
    expect(create).toContain("activeDashboardActivities");
    expect(create).toContain("toggleDuelDashboardSelection");
  });
});
