import { describe, expect, it } from "vitest";
import {
  createDefaultTrackerState,
  getDayKeyForMs,
  getDayTotalElapsed,
  getElapsedByActivityForDay,
  loadTrackerState,
  STORAGE_KEY_V2,
  STORAGE_KEY_V3,
  toggleActivity,
  processActiveTimer,
} from "./tracker";

type StorageMap = Record<string, string>;

function createMockStorage(map: StorageMap) {
  return {
    getItem(key: string) {
      return map[key] ?? null;
    },
  };
}

describe("tracker timer reliability", () => {
  it("accumulates only incremental elapsed time across repeated processing", () => {
    const startMs = new Date(2026, 0, 14, 9, 0, 0, 0).getTime();
    const state = createDefaultTrackerState(startMs);
    const started = toggleActivity(state, "coding", startMs);

    const first = processActiveTimer(started, startMs + 10_000);
    const second = processActiveTimer(first, startMs + 16_000);
    const duplicate = processActiveTimer(second, startMs + 16_000);

    const dayKey = getDayKeyForMs(startMs);
    const elapsed = getElapsedByActivityForDay(duplicate, dayKey);
    expect(elapsed.coding).toBe(16_000);
  });

  it("splits running time across local-midnight boundaries", () => {
    const beforeMidnight = new Date(2026, 0, 15, 23, 59, 30, 0).getTime();
    const afterMidnight = new Date(2026, 0, 16, 0, 0, 30, 0).getTime();
    const state = createDefaultTrackerState(beforeMidnight);
    const started = toggleActivity(state, "coding", beforeMidnight);
    const settled = processActiveTimer(started, afterMidnight);

    const day1 = getDayKeyForMs(beforeMidnight);
    const day2 = getDayKeyForMs(afterMidnight);
    const elapsedDay1 = getElapsedByActivityForDay(settled, day1);
    const elapsedDay2 = getElapsedByActivityForDay(settled, day2);

    expect(elapsedDay1.coding).toBe(30_000);
    expect(elapsedDay2.coding).toBe(30_000);
  });

  it("migrates v2 data and preserves today's records + activities", () => {
    const nowMs = new Date(2026, 3, 2, 12, 0, 0, 0).getTime();
    const todayKey = getDayKeyForMs(nowMs);
    const v2Payload = {
      dayKey: todayKey,
      activeActivityId: "deep-work",
      activeSinceMs: nowMs - 30_000,
      elapsedMs: {
        coding: 120_000,
        "deep-work": 60_000,
      },
      activities: [
        {
          id: "coding",
          name: "Coding",
          iconKey: "brain",
          color: "#8B95FF",
          goalMinutes: 120,
          cue: "Focus blocks",
        },
        {
          id: "deep-work",
          name: "Deep Work",
          iconKey: "briefcase",
          color: "#4FD1A5",
          goalMinutes: 90,
          cue: "Custom activity",
        },
      ],
    };
    const storage = createMockStorage({
      [STORAGE_KEY_V2]: JSON.stringify(v2Payload),
    });

    const migrated = loadTrackerState(storage, nowMs);
    const elapsed = getElapsedByActivityForDay(migrated, todayKey);
    const activityIds = new Set(migrated.activities.map((activity) => activity.id));

    expect(migrated.schemaVersion).toBe(3);
    expect(activityIds.has("deep-work")).toBe(true);
    expect(elapsed.coding).toBe(120_000);
    expect(elapsed["deep-work"]).toBe(90_000);
    expect(migrated.activeActivityId).toBe("deep-work");
  });

  it("supports one-tap switching and pause without losing elapsed time", () => {
    const startMs = new Date(2026, 4, 8, 8, 0, 0, 0).getTime();
    const dayKey = getDayKeyForMs(startMs);
    const initial = createDefaultTrackerState(startMs);
    const runningCoding = toggleActivity(initial, "coding", startMs);
    const switchedToGym = toggleActivity(runningCoding, "gym", startMs + 6_000);
    const pausedGym = toggleActivity(switchedToGym, "gym", startMs + 11_000);

    const elapsed = getElapsedByActivityForDay(pausedGym, dayKey);
    expect(elapsed.coding).toBe(6_000);
    expect(elapsed.gym).toBe(5_000);
    expect(pausedGym.activeActivityId).toBeNull();
  });

  it("keeps prior-day history while tracking new-day activity", () => {
    const day1Start = new Date(2026, 5, 10, 10, 0, 0, 0).getTime();
    const day1End = day1Start + 10 * 60_000;
    const day2Start = new Date(2026, 5, 11, 9, 0, 0, 0).getTime();
    const day2End = day2Start + 5 * 60_000;

    const initial = createDefaultTrackerState(day1Start);
    const day1Running = toggleActivity(initial, "coding", day1Start);
    const day1Paused = toggleActivity(day1Running, "coding", day1End);
    const day2Running = toggleActivity(day1Paused, "gym", day2Start);
    const finished = toggleActivity(day2Running, "gym", day2End);

    const day1Key = getDayKeyForMs(day1Start);
    const day2Key = getDayKeyForMs(day2Start);

    expect(getDayTotalElapsed(finished, day1Key)).toBe(10 * 60_000);
    expect(getDayTotalElapsed(finished, day2Key)).toBe(5 * 60_000);
  });

  it("does not re-credit time when the system clock moves backwards", () => {
    const startMs = new Date(2026, 1, 3, 10, 0, 0, 0).getTime();
    const running = toggleActivity(createDefaultTrackerState(startMs), "coding", startMs);
    const settled = processActiveTimer(running, startMs + 60_000);
    const storage = createMockStorage({ [STORAGE_KEY_V3]: JSON.stringify(settled) });

    const reloadedEarlier = loadTrackerState(storage, startMs + 30_000);
    const caughtUp = processActiveTimer(reloadedEarlier, startMs + 90_000);

    const elapsed = getElapsedByActivityForDay(caughtUp, getDayKeyForMs(startMs));
    expect(elapsed.coding).toBe(90_000);
  });

  it("falls back to defaults when v3 storage is malformed", () => {
    const nowMs = new Date(2026, 2, 5, 7, 0, 0, 0).getTime();
    const storage = createMockStorage({
      [STORAGE_KEY_V3]: "{malformed",
    });

    const loaded = loadTrackerState(storage, nowMs);
    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.activities.length).toBeGreaterThan(0);
    expect(loaded.activeActivityId).toBeNull();
  });
});
