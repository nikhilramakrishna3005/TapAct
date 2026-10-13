import { describe, expect, it } from "vitest";
import { isCurrentBoardResponse, showcaseHistoryKey } from "./navigation";

describe("duel board request freshness", () => {
  it("ignores a stale board response after the selection changes", () => {
    expect(isCurrentBoardResponse({
      requestId: "older",
      selectedId: "newer",
      generation: 1,
      latestGeneration: 2,
    })).toBe(false);
    expect(isCurrentBoardResponse({
      requestId: "newer",
      selectedId: "newer",
      generation: 2,
      latestGeneration: 2,
    })).toBe(true);
    expect(isCurrentBoardResponse({
      requestId: "newer",
      selectedId: null,
      generation: 2,
      latestGeneration: 2,
    })).toBe(false);
  });

  it("reloads Battle Showcase only when the completed set changes", () => {
    const first = showcaseHistoryKey([
      { id: "a", status: "active" },
      { id: "c", status: "completed" },
    ]);
    const sameCompleted = showcaseHistoryKey([
      { id: "a", status: "active" },
      { id: "c", status: "completed" },
      { id: "p", status: "pending" },
    ]);
    const changed = showcaseHistoryKey([
      { id: "c", status: "completed" },
      { id: "d", status: "completed" },
    ]);
    expect(first).toBe(sameCompleted);
    expect(first).not.toBe(changed);
    expect(first).toBe("c");
  });
});
