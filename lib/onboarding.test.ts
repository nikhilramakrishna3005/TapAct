import { describe, expect, it } from "vitest";
import { applyStarterActivities, STARTER_PRESETS } from "./onboarding";
import { createDefaultTrackerState, MS_PER_MINUTE, toggleActivity } from "./tracker";

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();

function preset(id: string) {
  const found = STARTER_PRESETS.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("applyStarterActivities", () => {
  it("replaces the default set with the chosen starters in order", () => {
    const state = createDefaultTrackerState(NOW);
    const next = applyStarterActivities(state, [preset("meditation"), { ...preset("reading"), goalMinutes: 50 }], NOW);
    expect(next.activities.map((a) => a.id)).toEqual(["meditation", "reading"]);
    expect(next.activities[1].goalMinutes).toBe(50);
    expect(next.activities.every((a) => a.archivedAtMs === null)).toBe(true);
  });

  it("archives unchosen activities that already have history and stops their timer", () => {
    let state = toggleActivity(createDefaultTrackerState(NOW), "gym", NOW);
    const later = NOW + 10 * MS_PER_MINUTE;
    const next = applyStarterActivities(state, [preset("writing")], later);
    const gym = next.activities.find((a) => a.id === "gym");
    expect(gym?.archivedAtMs).toBe(later);
    expect(next.activeActivityId).toBeNull();
    expect(next.dailyRecords["2026-10-12"].gym).toBe(10 * MS_PER_MINUTE);
    state = next;
    expect(state.activities.map((a) => a.id)).toEqual(["writing", "gym"]);
  });

  it("ignores an empty selection", () => {
    const state = createDefaultTrackerState(NOW);
    expect(applyStarterActivities(state, [], NOW)).toBe(state);
  });
});
