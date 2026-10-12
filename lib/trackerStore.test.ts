import { describe, expect, it } from "vitest";
import {
  addActivity,
  archiveActivity,
  getDayKeyForMs,
  getElapsedByActivityForDay,
  STORAGE_KEY_V2,
  STORAGE_KEY_V3,
  toggleActivity,
  type TrackerState,
} from "./tracker";
import {
  classifyStorageError,
  commitTrackerUpdate,
  syncFromStorage,
  type WritableStorageLike,
} from "./trackerStore";

class MemoryStorage implements WritableStorageLike {
  data = new Map<string, string>();
  failWrites: Error | null = null;
  failReads: Error | null = null;

  getItem(key: string) {
    if (this.failReads) {
      throw this.failReads;
    }
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) {
      throw this.failWrites;
    }
    this.data.set(key, value);
  }
}

function quotaError(): Error {
  const error = new Error("quota");
  error.name = "QuotaExceededError";
  return error;
}

/** Simulates one browser tab: its own in-memory state over a shared storage. */
class Tab {
  memory: TrackerState | null = null;
  lastFailure: string | null = null;

  constructor(private storage: WritableStorageLike | null) {}

  commit(update: (base: TrackerState, now: number) => TrackerState, now: number) {
    const result = commitTrackerUpdate(this.storage, this.memory, update, now);
    this.memory = result.state;
    this.lastFailure = result.failureReason;
    return result;
  }

  tap(activityId: string, now: number) {
    return this.commit((base, at) => toggleActivity(base, activityId, at), now);
  }

  sync(now: number) {
    this.memory = syncFromStorage(this.storage, this.memory, now);
  }
}

const T0 = new Date(2026, 6, 20, 9, 0, 0, 0).getTime();
const DAY = getDayKeyForMs(T0);

function elapsedFrom(storage: MemoryStorage, now: number) {
  return getElapsedByActivityForDay(syncFromStorage(storage, null, now), DAY);
}

describe("multi-tab persistence", () => {
  it("applies a stale tab's action on top of another tab's newer write", () => {
    const storage = new MemoryStorage();
    const tabA = new Tab(storage);
    const tabB = new Tab(storage);
    tabA.commit((base) => base, T0);
    tabB.commit((base) => base, T0);

    tabA.tap("coding", T0);
    // Tab B never received a storage event, so its memory still shows nothing running.
    tabB.tap("gym", T0 + 5_000);
    tabA.tap("gym", T0 + 12_000);

    const elapsed = elapsedFrom(storage, T0 + 60_000);
    expect(elapsed.coding).toBe(5_000);
    expect(elapsed.gym).toBe(7_000);
    expect(syncFromStorage(storage, null, T0 + 60_000).activeActivityId).toBeNull();
  });

  it("does not drop an activity added in another tab", () => {
    const storage = new MemoryStorage();
    const tabA = new Tab(storage);
    const tabB = new Tab(storage);
    tabA.commit((base) => base, T0);
    tabB.commit((base) => base, T0);

    tabA.commit(
      (base) =>
        addActivity(base, {
          id: "meditation-ab12",
          name: "Meditation",
          iconKey: "heart",
          color: "#9DE582",
          goalMinutes: 15,
          cue: "Custom activity",
        }),
      T0 + 1_000,
    );
    tabB.tap("reading", T0 + 2_000);

    const stored = syncFromStorage(storage, null, T0 + 3_000);
    expect(stored.activities.map((activity) => activity.id)).toContain("meditation-ab12");
    expect(stored.activeActivityId).toBe("reading");
  });

  it("never double-counts running time when several tabs settle the same timer", () => {
    const storage = new MemoryStorage();
    const tabA = new Tab(storage);
    const tabB = new Tab(storage);
    tabA.tap("coding", T0);
    tabB.sync(T0 + 1_000);

    for (let step = 1; step <= 10; step += 1) {
      const now = T0 + step * 3_000;
      tabA.commit((base) => base, now);
      tabB.commit((base) => base, now + 500);
      tabB.sync(now + 700);
    }
    tabA.tap("coding", T0 + 40_000);

    expect(elapsedFrom(storage, T0 + 50_000).coding).toBe(40_000);
  });

  it("adopts newer state from storage events and ignores older or corrupt payloads", () => {
    const storage = new MemoryStorage();
    const tabA = new Tab(storage);
    const tabB = new Tab(storage);
    tabA.commit((base) => base, T0);
    tabB.sync(T0);

    tabA.tap("gym", T0 + 1_000);
    tabB.sync(T0 + 2_000);
    expect(tabB.memory?.activeActivityId).toBe("gym");

    const revisionBefore = tabB.memory!.revision;
    storage.data.set(STORAGE_KEY_V3, "{not json");
    tabB.sync(T0 + 3_000);
    expect(tabB.memory?.revision).toBe(revisionBefore);
    expect(tabB.memory?.activeActivityId).toBe("gym");
  });
});

describe("storage failure handling", () => {
  it("reports quota failures, keeps tracking in memory, and recovers on the next write", () => {
    const storage = new MemoryStorage();
    const tab = new Tab(storage);
    tab.commit((base) => base, T0);

    storage.failWrites = quotaError();
    const failed = tab.tap("coding", T0);
    expect(failed.persisted).toBe(false);
    expect(failed.failureReason).toBe("quota");
    expect(tab.memory?.activeActivityId).toBe("coding");

    storage.failWrites = null;
    const recovered = tab.tap("coding", T0 + 30_000);
    expect(recovered.persisted).toBe(true);
    expect(recovered.failureReason).toBeNull();
    expect(elapsedFrom(storage, T0 + 60_000).coding).toBe(30_000);
  });

  it("treats missing or unreadable storage as unavailable without throwing", () => {
    const noStorage = new Tab(null);
    const result = noStorage.tap("gym", T0);
    expect(result.persisted).toBe(false);
    expect(result.failureReason).toBe("unavailable");
    expect(result.state.activeActivityId).toBe("gym");

    const storage = new MemoryStorage();
    storage.failReads = new Error("SecurityError");
    storage.failWrites = new Error("SecurityError");
    const blocked = new Tab(storage);
    expect(() => blocked.tap("gym", T0)).not.toThrow();
    expect(blocked.lastFailure).toBe("unavailable");
  });

  it("classifies browser-specific quota errors", () => {
    expect(classifyStorageError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe("quota");
    expect(classifyStorageError({ code: 22 })).toBe("quota");
    expect(classifyStorageError(new Error("denied"))).toBe("unavailable");
  });
});

describe("preservation across refresh and migration", () => {
  it("keeps archived and custom activities with their history after a refresh", () => {
    const storage = new MemoryStorage();
    const tab = new Tab(storage);
    tab.commit(
      (base) =>
        addActivity(base, {
          id: "piano-x1y2",
          name: "Piano",
          iconKey: "music",
          color: "#FFC86B",
          goalMinutes: 20,
          cue: "Custom activity",
        }),
      T0,
    );
    tab.tap("piano-x1y2", T0);
    tab.tap("reading", T0 + 90_000);
    tab.commit((base, now) => archiveActivity(base, "reading", now), T0 + 150_000);

    const refreshed = new Tab(storage);
    refreshed.commit((base) => base, T0 + 200_000);
    const state = refreshed.memory!;
    const piano = state.activities.find((activity) => activity.id === "piano-x1y2");
    const reading = state.activities.find((activity) => activity.id === "reading");

    expect(piano).toMatchObject({ name: "Piano", iconKey: "music", archivedAtMs: null });
    expect(reading?.archivedAtMs).toBe(T0 + 150_000);
    expect(state.activeActivityId).toBeNull();
    const elapsed = getElapsedByActivityForDay(state, DAY);
    expect(elapsed["piano-x1y2"]).toBe(90_000);
    expect(elapsed.reading).toBe(60_000);
  });

  it("migrates v2 custom activities into v3 once and keeps them across later refreshes", () => {
    const storage = new MemoryStorage();
    storage.data.set(
      STORAGE_KEY_V2,
      JSON.stringify({
        dayKey: DAY,
        activeActivityId: null,
        activeSinceMs: null,
        elapsedMs: { coding: 600_000, "yoga-zz11": 300_000 },
        activities: [
          { id: "coding", name: "Coding", iconKey: "brain", color: "#8B95FF", goalMinutes: 140, cue: "Deep work sessions" },
          { id: "yoga-zz11", name: "Yoga", iconKey: "heart", color: "#4FD1A5", goalMinutes: 30, cue: "Custom activity" },
        ],
      }),
    );

    new Tab(storage).commit((base) => base, T0);
    expect(storage.data.has(STORAGE_KEY_V3)).toBe(true);

    const later = new Tab(storage);
    later.commit((base, now) => archiveActivity(base, "yoga-zz11", now), T0 + 1_000);
    const reloaded = syncFromStorage(storage, null, T0 + 2_000);

    const yoga = reloaded.activities.find((activity) => activity.id === "yoga-zz11");
    expect(yoga?.name).toBe("Yoga");
    expect(yoga?.archivedAtMs).toBe(T0 + 1_000);
    const elapsed = getElapsedByActivityForDay(reloaded, DAY);
    expect(elapsed.coding).toBe(600_000);
    expect(elapsed["yoga-zz11"]).toBe(300_000);
  });
});
