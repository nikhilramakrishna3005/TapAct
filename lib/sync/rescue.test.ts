import { describe, expect, it } from "vitest";
import { createDefaultTrackerState, getDayKeyForMs, toggleActivity, type TrackerState } from "../tracker";
import { commitTrackerUpdate, type TrackerUpdate } from "../trackerStore";
import { recordCommit } from "./capture";
import { adoptAccount, runSync, type SyncDeps } from "./engine";
import { mergeEntryLists, type SyncActivity, type SyncSnapshot, type TimeEntry } from "./merge";
import { entryToRow, rowToEntry, SyncError, type SyncRemote } from "./remote";
import { rescueSession, type SessionChange, validateSessionDraft } from "./rescue";
import { addToOutbox, getOutbox, loadSyncMeta, removeConfirmed, saveSyncMeta } from "./state";

const MIN = 60_000;
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime();
const ADA = { userId: "user-ada", email: "ada@tapact.app" };

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

/** Mirrors the migration: owner-only rows, grow-only segments, sticky deletion. */
class FakeServer {
  seq = 0;
  activities: { userId: string; seq: number; item: SyncActivity }[] = [];
  entries: { userId: string; seq: number; item: TimeEntry }[] = [];
  offline = false;

  remoteFor(authUserId: string): SyncRemote {
    return {
      push: async (userId, changes: SyncSnapshot) => {
        if (this.offline) throw new SyncError("offline", "network");
        if (userId !== authUserId) throw new SyncError("auth", "RLS violation");
        for (const item of changes.activities) {
          const row = this.activities.find((r) => r.userId === userId && r.item.id === item.id);
          if (row) row.seq = ++this.seq;
          else this.activities.push({ userId, seq: ++this.seq, item });
        }
        for (const item of changes.entries) {
          const row = this.entries.find((r) => r.userId === userId && r.item.id === item.id);
          if (row) {
            row.item = mergeEntryLists([row.item], [item])[0];
            row.seq = ++this.seq;
          } else {
            this.entries.push({ userId, seq: ++this.seq, item });
          }
        }
      },
      pull: async (userId, cursors) => {
        if (this.offline) throw new SyncError("offline", "network");
        const since = Number(cursors.entries?.updatedAt ?? 0);
        const sinceA = Number(cursors.activities?.updatedAt ?? 0);
        const entries = this.entries.filter((r) => r.userId === userId && r.seq > since);
        const activities = this.activities.filter((r) => r.userId === userId && r.seq > sinceA);
        const tail = (rows: { seq: number }[], fallback: { updatedAt: string; id: string } | null) =>
          rows.length ? { updatedAt: String(Math.max(...rows.map((r) => r.seq))), id: "" } : fallback;
        return {
          snapshot: { activities: activities.map((r) => r.item), entries: entries.map((r) => ({ ...r.item })), baselines: [] },
          cursors: { activities: tail(activities, cursors.activities), entries: tail(entries, cursors.entries), baselines: null },
        };
      },
    };
  }
}

const clock = { now: T0 };

function createDevice(server: FakeServer) {
  const storage = new MemoryStorage();
  let memory: TrackerState | null = null;
  const commit = (update: TrackerUpdate, source: "user" | "sync") => {
    const result = commitTrackerUpdate(storage, memory, update, clock.now);
    memory = result.state;
    recordCommit(storage, result.base, result.state, clock.now, { captureActivities: source === "user" });
    return result.state;
  };
  commit((base) => base, "user");
  const deps = (): SyncDeps => ({
    storage,
    remote: server.remoteFor(ADA.userId),
    commit: (update) => commit(update, "sync"),
    now: () => clock.now,
    isCurrent: () => true,
  });
  const state = () => commit((base) => base, "sync");
  return {
    storage,
    deps,
    state,
    tap: (activityId: string) => commit((base, now) => toggleActivity(base, activityId, now), "user"),
    rescue: (change: SessionChange) => rescueSession(deps(), state(), change),
    entries: () => getOutbox(loadSyncMeta(storage), ADA.userId).entries,
  };
}

function on(state: TrackerState, ms: number, activityId: string): number {
  return state.dailyRecords[getDayKeyForMs(ms)]?.[activityId] ?? 0;
}

async function twoDevices() {
  clock.now = T0;
  const server = new FakeServer();
  const phone = createDevice(server);
  const laptop = createDevice(server);
  await adoptAccount(phone.deps(), ADA, { keepCurrent: false });
  await adoptAccount(laptop.deps(), ADA, { keepCurrent: false });
  return { server, phone, laptop };
}

describe("time rescue", () => {
  it("edits a session, recomputes totals on every device, and a stale upload can't restore it", async () => {
    const { server, phone, laptop } = await twoDevices();
    phone.tap("gym");
    clock.now = T0 + 20 * MIN;
    phone.tap("gym");
    await runSync(phone.deps(), ADA);
    await runSync(laptop.deps(), ADA);
    expect(on(laptop.state(), T0, "gym")).toBe(20 * MIN);
    const original = server.entries[0].item;

    clock.now = T0 + 60 * MIN;
    const result = phone.rescue({
      kind: "save",
      replaceIds: [original.id],
      draft: { activityId: "coding", startMs: T0 + 5 * MIN, endMs: T0 + 35 * MIN },
    });
    expect(result).toEqual({ ok: true });
    expect(on(phone.state(), T0, "gym")).toBe(0);
    expect(on(phone.state(), T0, "coding")).toBe(30 * MIN);

    await runSync(phone.deps(), ADA);
    await runSync(laptop.deps(), ADA);
    expect(on(laptop.state(), T0, "gym")).toBe(0);
    expect(on(laptop.state(), T0, "coding")).toBe(30 * MIN);

    // A device that still has the old segment queued re-uploads it.
    const meta = loadSyncMeta(laptop.storage);
    saveSyncMeta(laptop.storage, addToOutbox(meta, ADA.userId, { entries: [original] }));
    await runSync(laptop.deps(), ADA);
    await runSync(phone.deps(), ADA);
    for (const device of [phone, laptop]) {
      expect(on(device.state(), T0, "gym")).toBe(0);
      expect(on(device.state(), T0, "coding")).toBe(30 * MIN);
    }
    const stored = server.entries.map((row) => row.item);
    expect(stored.find((entry) => entry.id === original.id)?.deletedAtMs).toBe(T0 + 60 * MIN);
    expect(stored.filter((entry) => entry.source === "manual")).toHaveLength(1);
  });

  it("deletes offline and syncs the deletion after reconnecting", async () => {
    const { server, phone, laptop } = await twoDevices();
    laptop.tap("reading");
    clock.now = T0 + 40 * MIN;
    laptop.tap("reading");
    await runSync(laptop.deps(), ADA);
    await runSync(phone.deps(), ADA);
    const id = server.entries[0].item.id;

    server.offline = true;
    expect(phone.rescue({ kind: "delete", replaceIds: [id] })).toEqual({ ok: true });
    expect(on(phone.state(), T0, "reading")).toBe(0);
    await expect(runSync(phone.deps(), ADA)).rejects.toThrow();
    expect(phone.entries().some((entry) => entry.id === id && entry.deletedAtMs !== undefined)).toBe(true);

    server.offline = false;
    await runSync(phone.deps(), ADA);
    await runSync(laptop.deps(), ADA);
    expect(on(laptop.state(), T0, "reading")).toBe(0);
    expect(phone.entries()).toHaveLength(0);
  });

  it("adds a manual session across midnight and splits it between days", async () => {
    const { phone } = await twoDevices();
    const start = new Date(2026, 9, 11, 23, 30).getTime();
    clock.now = T0;
    expect(
      phone.rescue({ kind: "save", replaceIds: [], draft: { activityId: "reading", startMs: start, endMs: start + 75 * MIN } }),
    ).toEqual({ ok: true });
    const state = phone.state();
    expect(on(state, start, "reading")).toBe(30 * MIN);
    expect(on(state, start + 75 * MIN, "reading")).toBe(45 * MIN);
  });

  it("never touches the running timer and refuses changes that overlap it", async () => {
    const { phone } = await twoDevices();
    phone.tap("coding");
    clock.now = T0 + 30 * MIN;
    const before = phone.state();
    const running = phone.entries()[0];

    expect(phone.rescue({ kind: "delete", replaceIds: [running.id] }).ok).toBe(false);
    expect(
      phone.rescue({ kind: "save", replaceIds: [], draft: { activityId: "gym", startMs: T0 + 10 * MIN, endMs: T0 + 20 * MIN } }).ok,
    ).toBe(false);
    expect(
      phone.rescue({ kind: "save", replaceIds: [], draft: { activityId: "gym", startMs: T0 - 60 * MIN, endMs: T0 - 30 * MIN } }),
    ).toEqual({ ok: true });

    const after = phone.state();
    expect(after.activeActivityId).toBe("coding");
    expect(after.activeSinceMs).toBe(before.activeSinceMs);
    expect(on(after, T0, "coding")).toBe(30 * MIN);
    expect(on(after, T0, "gym")).toBe(30 * MIN);
  });

  it("requires a synced account", () => {
    clock.now = T0;
    const guest = createDevice(new FakeServer());
    const result = guest.rescue({ kind: "save", replaceIds: [], draft: { activityId: "gym", startMs: T0 - 60 * MIN, endMs: T0 - 30 * MIN } });
    expect(result.ok).toBe(false);
  });
});

describe("session validation", () => {
  const activities = createDefaultTrackerState(T0).activities;
  const base = { entries: [] as TimeEntry[], replaceIds: [], running: null, activities, nowMs: T0 };
  const entry: TimeEntry = { id: "x", activityId: "gym", deviceId: "d", startMs: T0 - 60 * MIN, endMs: T0 - 30 * MIN };

  it("rejects zero, negative, too long, future and invalid sessions", () => {
    const check = (startMs: number, endMs: number, activityId = "coding") =>
      validateSessionDraft({ activityId, startMs, endMs }, base)?.message ?? null;
    expect(check(T0 - MIN, T0 - MIN)).toMatch(/after start/);
    expect(check(T0 - MIN, T0 - 2 * MIN)).toMatch(/after start/);
    expect(check(T0 - 30_000, T0)).toMatch(/at least 1 minute/);
    expect(check(T0 - 25 * 60 * MIN, T0)).toMatch(/24 hours/);
    expect(check(T0, T0 + 10 * MIN)).toMatch(/future/);
    expect(check(Number.NaN, T0)).toMatch(/valid/);
    expect(check(T0 - 10 * MIN, T0, "missing")).toMatch(/activity/);
    expect(check(T0 - 10 * MIN, T0)).toBeNull();
  });

  it("rejects overlaps, except with the session being replaced or deleted ones", () => {
    const draft = { activityId: "coding", startMs: T0 - 45 * MIN, endMs: T0 - 15 * MIN };
    expect(validateSessionDraft(draft, { ...base, entries: [entry] })?.conflict?.id).toBe("x");
    expect(validateSessionDraft(draft, { ...base, entries: [entry], replaceIds: ["x"] as never[] })).toBeNull();
    expect(validateSessionDraft(draft, { ...base, entries: [{ ...entry, deletedAtMs: 1 }] })).toBeNull();
    expect(validateSessionDraft({ ...draft, startMs: T0 - 30 * MIN }, { ...base, entries: [entry] })).toBeNull();
  });
});

describe("deletion merge rules", () => {
  const entry: TimeEntry = { id: "e", activityId: "gym", deviceId: "d", startMs: T0, endMs: T0 + MIN };

  it("keeps deletion sticky in any merge order and through the row mapping", () => {
    const deleted = { ...entry, deletedAtMs: T0 + 5 * MIN };
    const grown = { ...entry, endMs: T0 + 3 * MIN };
    for (const merged of [mergeEntryLists([deleted], [grown])[0], mergeEntryLists([grown], [deleted])[0]]) {
      expect(merged.deletedAtMs).toBe(T0 + 5 * MIN);
      expect(merged.endMs).toBe(T0 + 3 * MIN);
    }
    const row = entryToRow("u", { ...deleted, source: "manual" });
    expect(row).toMatchObject({ source: "manual", deleted_at_ms: T0 + 5 * MIN });
    expect(rowToEntry(row)).toEqual({ ...deleted, source: "manual" });
    expect(entryToRow("u", entry)).not.toHaveProperty("deleted_at_ms");
  });

  it("keeps a deletion queued while an upload of the live copy was in flight", () => {
    const meta = { ...loadSyncMeta(null), owner: ADA };
    const queued = addToOutbox(meta, ADA.userId, { entries: [entry] });
    const sent = getOutbox(queued, ADA.userId);
    const deletedMeanwhile = addToOutbox(queued, ADA.userId, { entries: [{ ...entry, deletedAtMs: T0 }] });
    const after = removeConfirmed(deletedMeanwhile, ADA.userId, sent);
    expect(getOutbox(after, ADA.userId).entries[0]?.deletedAtMs).toBe(T0);
  });
});
