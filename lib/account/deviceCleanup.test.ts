import { describe, expect, it } from "vitest";
import { createDefaultTrackerState, DEFAULT_ACTIVITIES, STORAGE_KEY_V3 } from "../tracker";
import { toSyncActivity } from "../sync/merge";
import { runSync } from "../sync/engine";
import { captureCommit } from "../sync/capture";
import {
  loadStash,
  loadSyncMeta,
  saveStash,
  saveSyncCache,
  saveSyncMeta,
  SYNC_CACHE_KEY,
  SYNC_STASH_KEY,
} from "../sync/state";
import { forgetDeletedAccount } from "./deviceCleanup";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

describe("local cleanup after account deletion", () => {
  it("clears the deleted account and leaves another account's data", () => {
    const storage = new MemoryStorage();
    const now = Date.parse("2026-10-15T18:00:00.000Z");
    const meta = loadSyncMeta(storage);
    saveSyncMeta(storage, {
      ...meta,
      owner: { userId: "ada", email: "ada@example.test" },
      outboxes: [
        { userId: "ada", activities: [toSyncActivity(DEFAULT_ACTIVITIES[0], 1, "device")], entries: [], baselines: [] },
        { userId: "bo", activities: [toSyncActivity(DEFAULT_ACTIVITIES[1], 1, "device")], entries: [], baselines: [] },
      ],
      lastSyncedUserId: "ada",
    });
    saveSyncCache(storage, {
      userId: "ada",
      cursors: { activities: null, entries: null, baselines: null },
      snapshot: { activities: [], entries: [], baselines: [] },
    });
    const guest = createDefaultTrackerState(now);
    const boTracker = { ...createDefaultTrackerState(now), activeActivityId: "coding" };
    saveStash(storage, [
      { id: "guest", ownerUserId: null, ownerEmail: null, stashedAtMs: now, mergedIntoUserId: null, tracker: guest },
      { id: "ada-stash", ownerUserId: "ada", ownerEmail: "ada@example.test", stashedAtMs: now, mergedIntoUserId: null, tracker: guest },
      { id: "bo-stash", ownerUserId: "bo", ownerEmail: "bo@example.test", stashedAtMs: now, mergedIntoUserId: null, tracker: boTracker },
    ]);
    storage.setItem(STORAGE_KEY_V3, JSON.stringify({ ...createDefaultTrackerState(now), activeActivityId: "reading", activeSinceMs: now, lastProcessedMs: now }));

    const result = forgetDeletedAccount(storage, "ada", now);
    const next = loadSyncMeta(storage);
    expect(result.resetTracker).toBe(true);
    expect(next.owner).toBeNull();
    expect(next.outboxes.map((item) => item.userId)).toEqual(["bo"]);
    expect(next.blockedUserIds).toContain("ada");
    expect(next.lastSyncedUserId).toBeNull();
    expect(storage.getItem(SYNC_CACHE_KEY)).toBeNull();
    expect(loadStash(storage, now).map((item) => item.id)).toEqual(["guest", "bo-stash"]);
    const tracker = JSON.parse(storage.getItem(STORAGE_KEY_V3) ?? "{}") as { activeActivityId: string | null };
    expect(tracker.activeActivityId).toBeNull();
    expect(storage.getItem(SYNC_STASH_KEY)).toContain("bo-stash");
  });

  it("does not reset a tracker owned by someone else", () => {
    const storage = new MemoryStorage();
    const now = Date.parse("2026-10-15T18:00:00.000Z");
    const meta = loadSyncMeta(storage);
    saveSyncMeta(storage, { ...meta, owner: { userId: "bo", email: "bo@example.test" } });
    storage.setItem(STORAGE_KEY_V3, "{\"keep\":\"bo\"}");
    const result = forgetDeletedAccount(storage, "ada", now);
    expect(result.resetTracker).toBe(false);
    expect(storage.getItem(STORAGE_KEY_V3)).toBe("{\"keep\":\"bo\"}");
    expect(loadSyncMeta(storage).owner?.userId).toBe("bo");
    expect(loadSyncMeta(storage).blockedUserIds).toContain("ada");
  });

  it("stops a blocked account from uploading or recapturing edits", async () => {
    const storage = new MemoryStorage();
    const now = Date.parse("2026-10-15T18:00:00.000Z");
    const meta = loadSyncMeta(storage);
    saveSyncMeta(storage, {
      ...meta,
      owner: { userId: "ada", email: "ada@example.test" },
      blockedUserIds: ["ada"],
      outboxes: [{ userId: "ada", activities: [toSyncActivity(DEFAULT_ACTIVITIES[0], 1, meta.deviceId)], entries: [], baselines: [] }],
    });
    const pushes: string[] = [];
    const result = await runSync(
      {
        storage,
        now: () => now,
        isCurrent: () => true,
        commit: (update) => update(createDefaultTrackerState(now), now),
        remote: {
          push: async (userId) => {
            pushes.push(userId);
          },
          pull: async () => ({
            cursors: { activities: null, entries: null, baselines: null },
            snapshot: { activities: [], entries: [], baselines: [] },
          }),
        },
      },
      { userId: "ada", email: "ada@example.test" },
    );
    expect(result.kind).toBe("aborted");
    expect(pushes).toEqual([]);
    const blocked = loadSyncMeta(storage);
    const captured = captureCommit(blocked, createDefaultTrackerState(now), { ...createDefaultTrackerState(now), activeActivityId: "reading" }, now, { captureActivities: true });
    expect(captured.outboxes.find((item) => item.userId === "ada")?.activities).toHaveLength(1);
  });
});
