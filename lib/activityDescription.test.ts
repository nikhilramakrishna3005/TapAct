import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreMember } from "./duels/score";
import {
  createDefaultTrackerState,
  getDayKeyForMs,
  getElapsedByActivityForDay,
  loadTrackerState,
  STORAGE_KEY_V3,
  toggleActivity,
  updateActivity,
  type TrackerState,
} from "./tracker";
import { commitTrackerUpdate, type TrackerUpdate } from "./trackerStore";
import { recordCommit } from "./sync/capture";
import { applySnapshot } from "./sync/merge";
import { activityToRow, rowToActivity } from "./sync/remote";
import { getOutbox, loadSyncMeta, saveSyncMeta, type SyncMeta } from "./sync/state";

const MIN = 60_000;
const START = Date.UTC(2026, 9, 12, 15, 0, 0);

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

function activity(state: TrackerState, id: string) {
  const found = state.activities.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("activity descriptions", () => {
  it("edits the description without resetting the timer, goal, history, or id", () => {
    const started = toggleActivity(createDefaultTrackerState(START), "coding", START);
    const credited = {
      ...started,
      lastProcessedMs: START + 12 * MIN,
      dailyRecords: { "2026-10-12": { coding: 12 * MIN, gym: 5 * MIN } },
    };
    const edited = updateActivity(credited, "coding", { name: "Building", cue: "  Ship the sync  " });
    const coding = activity(edited, "coding");

    expect(coding).toMatchObject({
      id: "coding",
      name: "Building",
      cue: "Ship the sync",
      goalMinutes: 140,
      iconKey: "brain",
      color: "#8B95FF",
    });
    expect(edited.activeActivityId).toBe("coding");
    expect(edited.activeSinceMs).toBe(START);
    expect(edited.dailyRecords).toEqual(credited.dailyRecords);
    expect(edited.activities).toHaveLength(credited.activities.length);
    expect(activity(edited, "gym").cue).toBe("Strength and cardio");
  });

  it("treats a blank description as optional and keeps an omitted one", () => {
    const base = createDefaultTrackerState(START);
    const cleared = updateActivity(base, "gym", { cue: "   " });
    expect(activity(cleared, "gym").cue).toBe("");
    expect(activity(cleared, "gym").goalMinutes).toBe(50);
    const renamed = updateActivity(cleared, "gym", { name: "Lifting" });
    expect(activity(renamed, "gym")).toMatchObject({ id: "gym", name: "Lifting", cue: "" });
  });

  it("loads older activities that have no description", () => {
    const storage = new MemoryStorage();
    const seed = createDefaultTrackerState(START);
    const activities = seed.activities.map((item) => {
      if (item.id !== "gym") return item;
      const { cue: _cue, ...rest } = item;
      return rest;
    });
    storage.setItem(
      STORAGE_KEY_V3,
      JSON.stringify({
        ...seed,
        revision: 4,
        dailyRecords: { "2026-10-12": { gym: 8 * MIN } },
        activities: [
          ...activities.filter((item) => item.id !== "communication"),
          {
            id: "communication",
            name: "Communication",
            iconKey: "message",
            color: "#E0A6FF",
            goalMinutes: 45,
            cue: "",
            archivedAtMs: null,
            category: null,
          },
        ],
      }),
    );

    const loaded = loadTrackerState(storage, START);
    expect(activity(loaded, "gym").cue).toBe("");
    expect(activity(loaded, "communication").cue).toBe("");
    expect(activity(loaded, "coding").cue).toBe("Deep work sessions");
    expect(activity(loaded, "gym")).toMatchObject({ id: "gym", goalMinutes: 50, name: "Gym" });
    expect(getElapsedByActivityForDay(loaded, "2026-10-12").gym).toBe(8 * MIN);
  });

  it("persists a description edit locally and through the cloud activity row", () => {
    const storage = new MemoryStorage();
    let memory: TrackerState | null = null;
    const commit = (update: TrackerUpdate, now: number) => {
      const result = commitTrackerUpdate(storage, memory, update, now, null);
      memory = result.state;
      return result;
    };
    commit((base) => base, START);
    const saved = commit((base) => updateActivity(base, "coding", { cue: "Ship the sync" }), START + MIN);

    const refreshed = loadTrackerState(storage, START + 2 * MIN);
    expect(activity(refreshed, "coding")).toMatchObject({
      id: "coding",
      cue: "Ship the sync",
      goalMinutes: 140,
      name: "Coding",
    });
    expect(refreshed.activities.map((item) => item.id)).toEqual(saved.state.activities.map((item) => item.id));

    const owner: SyncMeta = {
      version: 1,
      deviceId: "phone",
      owner: { userId: "ada", email: "ada@example.com" },
      floor: null,
      outboxes: [],
      lastSyncedAtMs: null,
      lastSyncedUserId: null,
    };
    saveSyncMeta(storage, owner);
    expect(recordCommit(storage, saved.base, saved.state, START + MIN, { captureActivities: true })).toBe(true);
    const queued = getOutbox(loadSyncMeta(storage), "ada").activities.find((item) => item.id === "coding");
    expect(queued?.cue).toBe("Ship the sync");
    const row = activityToRow("ada", queued!);
    expect(row.cue).toBe("Ship the sync");
    expect(row.id).toBe("coding");

    const pulled = rowToActivity(row);
    const otherDevice = applySnapshot(
      createDefaultTrackerState(START),
      { activities: pulled ? [pulled] : [], entries: [], baselines: [] },
      START + 2 * MIN,
      "laptop",
      null,
    );
    expect(activity(otherDevice, "coding").cue).toBe("Ship the sync");
    expect(otherDevice.activities.filter((item) => item.id === "coding")).toHaveLength(1);
    expect(rowToActivity({ ...row, cue: undefined })?.cue).toBe("");
  });

  it("wires the edit sheet to the optional description and still adds activities only from Today", () => {
    const page = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    const card = readFileSync(resolve(process.cwd(), "app/components/ActivityCard.tsx"), "utf8");
    expect(page).toContain("Description (optional)");
    expect(page).toContain("showDescription");
    expect(page).toContain("cue: editDraft.description");
    expect(page).toContain("addActivity");
    expect(card).toContain("activity.cue");
    expect(card).toContain("Edit ${activity.name}");
  });
});

describe("descriptions, duels, and offline sync", () => {
  it("scores one tracked session once, including after rename and across two duels", () => {
    const session = { activityId: "coding", startMs: START, endMs: START + 25 * MIN, source: "timer" as const };
    const score = (trackerActivityId: string, sessions = [session]) =>
      scoreMember(
        {
          id: "ada",
          timeZone: "UTC",
          activities: [{ id: `challenge-${trackerActivityId}`, targetMinutes: 20, trackerActivityId }],
          sessions,
        },
        "2026-10-12",
        7,
      );

    const once = score("coding");
    const duplicated = score("coding", [session, { ...session }]);
    expect(once.days[0].activities[0].minutes).toBe(25);
    expect(once.points).toBe(30);
    expect(duplicated.days[0].activities[0].minutes).toBe(25);
    expect(duplicated.points).toBe(once.points);

    const renamed = updateActivity(createDefaultTrackerState(START), "coding", {
      name: "Building",
      cue: "Still the same activity",
    });
    expect(activity(renamed, "coding").id).toBe("coding");
    expect(score(activity(renamed, "coding").id).points).toBe(30);

    const secondDuel = scoreMember(
      {
        id: "ada",
        timeZone: "UTC",
        activities: [{ id: "other-duel-challenge", targetMinutes: 20, trackerActivityId: "coding" }],
        sessions: [session],
      },
      "2026-10-12",
      7,
    );
    expect(secondDuel.points).toBe(30);
    expect(renamed.activities.filter((item) => item.id === "coding")).toHaveLength(1);

    const legacy = scoreMember(
      {
        id: "ada",
        timeZone: "UTC",
        activities: [{ id: "legacy-challenge", targetMinutes: 20, trackerActivityId: "coding-ab12" }],
        sessions: [{ activityId: "coding-ab12", startMs: START, endMs: START + 25 * MIN, source: "timer" }],
      },
      "2026-10-12",
      7,
    );
    expect(legacy.days[0].activities[0]).toMatchObject({ id: "legacy-challenge", minutes: 25, met: true });
    expect(legacy.points).toBe(30);
  });

  it("keeps offline tracking and a description edit for the next cloud sync", () => {
    const storage = new MemoryStorage();
    let memory: TrackerState | null = null;
    const owner: SyncMeta = {
      version: 1,
      deviceId: "phone",
      owner: { userId: "ada", email: "ada@example.com" },
      floor: null,
      outboxes: [],
      lastSyncedAtMs: null,
      lastSyncedUserId: null,
    };
    saveSyncMeta(storage, owner);
    const commit = (update: TrackerUpdate, now: number) => {
      const result = commitTrackerUpdate(storage, memory, update, now, null);
      memory = result.state;
      recordCommit(storage, result.base, result.state, now, { captureActivities: true });
      return result;
    };

    commit((base) => base, START);
    commit((base) => updateActivity(base, "coding", { cue: "Offline draft" }), START);
    commit((base) => toggleActivity(base, "coding", START), START);
    const stopped = commit((base) => toggleActivity(base, "coding", START + 25 * MIN), START + 25 * MIN);

    const dayKey = getDayKeyForMs(START);
    expect(activity(stopped.state, "coding")).toMatchObject({ id: "coding", cue: "Offline draft", goalMinutes: 140 });
    expect(stopped.state.activeActivityId).toBeNull();
    expect(getElapsedByActivityForDay(stopped.state, dayKey).coding).toBe(25 * MIN);

    const outbox = getOutbox(loadSyncMeta(storage), "ada");
    expect(outbox.activities.find((item) => item.id === "coding")?.cue).toBe("Offline draft");
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({ activityId: "coding", startMs: START, endMs: START + 25 * MIN });

    const queued = outbox.activities.find((item) => item.id === "coding");
    const pulled = rowToActivity(activityToRow("ada", queued!));
    const synced = applySnapshot(
      createDefaultTrackerState(START),
      { activities: pulled ? [pulled] : [], entries: [...outbox.entries, ...outbox.entries], baselines: [] },
      START + 25 * MIN,
      "laptop",
      null,
    );
    expect(activity(synced, "coding").cue).toBe("Offline draft");
    expect(synced.activities.filter((item) => item.id === "coding")).toHaveLength(1);
    expect(getElapsedByActivityForDay(synced, dayKey).coding).toBe(25 * MIN);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(
      scoreMember(
        {
          id: "ada",
          timeZone: zone,
          activities: [{ id: "challenge", targetMinutes: 20, trackerActivityId: "coding" }],
          sessions: outbox.entries.map((entry) => ({ ...entry, source: "timer" as const })),
        },
        dayKey,
        7,
      ).days[0].activities[0].minutes,
    ).toBe(25);
  });
});
