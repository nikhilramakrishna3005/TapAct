import { describe, expect, it } from "vitest";
import { scoreMember } from "./score";
import {
  CREATE_ACTIVITY_ON_TODAY_MESSAGE,
  activeDashboardActivities,
  decideDuelActivityLink,
  draftFromDashboardActivity,
  linkWithoutDuplicating,
  planJoinLink,
  toggleDuelDashboardSelection,
  trackerUsedByOtherChallenge,
  type ConnectableActivity,
} from "./connect";

const coding = (patch: Partial<ConnectableActivity> = {}): ConnectableActivity => ({
  id: "coding",
  name: "Coding",
  archivedAtMs: null,
  goalMinutes: 140,
  ...patch,
});

const gym = (patch: Partial<ConnectableActivity> = {}): ConnectableActivity => ({
  id: "gym",
  name: "Gym",
  archivedAtMs: null,
  goalMinutes: 50,
  ...patch,
});

describe("duel dashboard activity selection", () => {
  it("offers only active Today activities when creating a duel", () => {
    const archived = gym({ archivedAtMs: 10 });
    const dashboard = activeDashboardActivities([coding(), archived, gym()]);
    expect(dashboard.map((item) => item.id)).toEqual(["coding", "gym"]);

    const first = toggleDuelDashboardSelection([], coding());
    expect(first).toEqual({
      ok: true,
      activities: [{ name: "Coding", targetMinutes: 140, trackerActivityId: "coding" }],
    });
    if (!first.ok) return;
    const both = toggleDuelDashboardSelection(first.activities, gym());
    expect(both.ok && both.activities.map((item) => item.trackerActivityId)).toEqual(["coding", "gym"]);
    const removed = both.ok ? toggleDuelDashboardSelection(both.activities, coding()) : both;
    expect(removed.ok && removed.activities).toEqual([
      { name: "Gym", targetMinutes: 50, trackerActivityId: "gym" },
    ]);
  });

  it("does not create a second activity when the same one is selected again", () => {
    const dashboard = [coding(), gym()];
    const selected = toggleDuelDashboardSelection([], coding());
    expect(selected.ok && selected.activities).toHaveLength(1);
    const again = selected.ok ? toggleDuelDashboardSelection(selected.activities, coding()) : selected;
    expect(again.ok && again.activities).toEqual([]);
    const linked = linkWithoutDuplicating(dashboard, "coding");
    expect(linked).toEqual({ activities: dashboard, linkedId: "coding" });
    expect(dashboard).toHaveLength(2);
    expect(draftFromDashboardActivity(gym({ archivedAtMs: 5 }))).toBeNull();
  });

  it("links a joining user to one of their own activities and explains an empty dashboard", () => {
    expect(planJoinLink([])).toEqual({ kind: "empty", message: CREATE_ACTIVITY_ON_TODAY_MESSAGE });
    expect(planJoinLink([gym({ archivedAtMs: 1 })])).toEqual({
      kind: "empty",
      message: CREATE_ACTIVITY_ON_TODAY_MESSAGE,
    });
    const choices = planJoinLink([coding({ id: "friend-coding", name: "Coding" }), gym({ id: "friend-gym" })]);
    expect(choices.kind === "choose" && choices.activities.map((item) => item.id)).toEqual([
      "friend-coding",
      "friend-gym",
    ]);
    expect(
      decideDuelActivityLink({
        duelName: "Coding",
        mappedTrackerId: null,
        activities: choices.kind === "choose" ? choices.activities : [],
        selectedTrackerId: "friend-gym",
      }),
    ).toEqual({ action: "link", trackerActivityId: "friend-gym" });
  });

  it("lets several duels share one activity id and still counts a session once in each", () => {
    const dashboard = [coding(), gym()];
    const first = linkWithoutDuplicating(dashboard, "coding");
    const second = linkWithoutDuplicating(first.activities, "coding");
    expect(second.activities).toBe(dashboard);
    expect(second.linkedId).toBe("coding");
    expect(trackerUsedByOtherChallenge(
      [{ challengeActivityId: "read", trackerActivityId: "coding" }],
      "move",
      "coding",
    )).toBe(true);
    expect(trackerUsedByOtherChallenge(
      [{ challengeActivityId: "read", trackerActivityId: "coding" }],
      "read",
      "coding",
    )).toBe(false);

    const session = {
      activityId: "coding",
      startMs: Date.UTC(2026, 9, 12, 15, 0, 0),
      endMs: Date.UTC(2026, 9, 12, 15, 25, 0),
      source: "timer" as const,
    };
    const score = (challengeId: string) =>
      scoreMember(
        {
          id: "ada",
          timeZone: "UTC",
          activities: [{ id: challengeId, targetMinutes: 20, trackerActivityId: "coding" }],
          sessions: [session, session],
        },
        "2026-10-12",
        7,
      );
    expect(score("duel-a").days[0].activities[0].minutes).toBe(25);
    expect(score("duel-b").days[0].activities[0].minutes).toBe(25);
    expect(score("duel-a").points).toBe(30);

    const renamed = { ...coding(), name: "Building" };
    expect(renamed.id).toBe("coding");
    expect(linkWithoutDuplicating([renamed], renamed.id).linkedId).toBe("coding");
    expect(score(renamed.id).days[0].activities[0].minutes).toBe(25);
  });

  it("keeps an existing mapping scoreable when the activity has no description", () => {
    const legacy = coding({ id: "coding-ab12", name: "Coding", goalMinutes: null });
    expect(draftFromDashboardActivity({ ...legacy, goalMinutes: undefined })?.trackerActivityId).toBe("coding-ab12");
    const scored = scoreMember(
      {
        id: "ada",
        timeZone: "UTC",
        activities: [{ id: "legacy-challenge", targetMinutes: 20, trackerActivityId: "coding-ab12" }],
        sessions: [
          {
            activityId: "coding-ab12",
            startMs: Date.UTC(2026, 9, 12, 15, 0, 0),
            endMs: Date.UTC(2026, 9, 12, 15, 25, 0),
            source: "timer",
          },
        ],
      },
      "2026-10-12",
      7,
    );
    expect(scored.points).toBe(30);
    expect(scored.days[0].activities[0].id).toBe("legacy-challenge");
  });
});
