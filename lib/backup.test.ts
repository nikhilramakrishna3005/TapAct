import { describe, expect, it } from "vitest";
import { createBackup, parseBackup } from "./backup";
import {
  addActivity,
  archiveActivity,
  createDefaultTrackerState,
  MS_PER_MINUTE,
  toggleActivity,
} from "./tracker";

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();

function sampleState() {
  let state = createDefaultTrackerState(NOW);
  state = addActivity(state, {
    id: "piano-ab12",
    name: "Piano",
    iconKey: "music",
    color: "#FFB47D",
    goalMinutes: 30,
    cue: "Custom activity",
  });
  state = archiveActivity(state, "gym", NOW);
  state = {
    ...state,
    revision: 7,
    dailyRecords: {
      "2026-10-10": { gym: 50 * MS_PER_MINUTE, "piano-ab12": 20 * MS_PER_MINUTE },
      "2026-10-12": { coding: 90 * MS_PER_MINUTE },
    },
  };
  return state;
}

describe("backup", () => {
  it("round-trips custom, archived activities and history", () => {
    const state = sampleState();
    const backup = createBackup(state, NOW);
    const result = parseBackup(JSON.stringify(backup), NOW + 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.activities).toEqual(state.activities);
    expect(result.state.dailyRecords).toEqual(state.dailyRecords);
    expect(result.state.schemaVersion).toBe(3);
    expect(result.summary).toMatchObject({ activityCount: 5, archivedCount: 1, dayCount: 2 });
  });

  it("settles a running timer on export and stops it on import", () => {
    const running = toggleActivity(sampleState(), "coding", NOW);
    const backup = createBackup(running, NOW + 10 * MS_PER_MINUTE);
    expect(backup.tracker.dailyRecords["2026-10-12"].coding).toBe(100 * MS_PER_MINUTE);

    const result = parseBackup(JSON.stringify(backup), NOW + 120 * MS_PER_MINUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.activeActivityId).toBeNull();
    expect(result.state.dailyRecords["2026-10-12"].coding).toBe(100 * MS_PER_MINUTE);
  });

  it("rejects invalid files", () => {
    expect(parseBackup("not json", NOW).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: "world" }), NOW).ok).toBe(false);
    expect(
      parseBackup(JSON.stringify({ kind: "tapact-backup", backupVersion: 99, tracker: {} }), NOW).ok,
    ).toBe(false);
    expect(
      parseBackup(
        JSON.stringify({ schemaVersion: 3, activities: [], dailyRecords: {} }),
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      parseBackup(
        JSON.stringify({ schemaVersion: 3, activities: [{ id: "a", name: "A" }] }),
        NOW,
      ).ok,
    ).toBe(false);
  });
});
