import { describe, expect, it } from "vitest";
import {
  addActivity,
  archiveActivity,
  createDefaultTrackerState,
  getDayKeyForMs,
  getDayTotalElapsed,
  toggleActivity,
  type TrackerState,
  updateActivity,
} from "../tracker";
import { commitTrackerUpdate, type TrackerUpdate } from "../trackerStore";
import { captureCommit, recordCommit } from "./capture";
import { adoptAccount, detachForRestore, importLocalData, runSync, type SyncDeps } from "./engine";
import {
  type Baseline,
  computeDailyRecords,
  mergeActivity,
  mergeEntryLists,
  type SyncActivity,
  type SyncSnapshot,
  type TimeEntry,
  unionIntervals,
} from "./merge";
import { SyncError, type SyncRemote } from "./remote";
import {
  decideOwnership,
  getOutbox,
  loadStash,
  loadSyncMeta,
  removeConfirmed,
  saveSyncMeta,
  type SyncMeta,
} from "./state";

const MIN = 60_000;
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime();

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

type Row<T> = { userId: string; seq: number; item: T };

/** In-memory server with the migration's merge rules and owner isolation (RLS). */
class FakeServer {
  seq = 0;
  activities: Row<SyncActivity>[] = [];
  entries: Row<TimeEntry>[] = [];
  baselines: Row<Baseline>[] = [];
  failNextPush: SyncError | null = null;
  pushCalls = 0;
  pullCalls = 0;

  private stamp() {
    this.seq += 1;
    return this.seq;
  }

  private upsert<T extends { id: string }>(rows: Row<T>[], userId: string, item: T, merge: (old: T, next: T) => T) {
    const existing = rows.find((row) => row.userId === userId && row.item.id === item.id);
    if (existing) {
      existing.item = merge(existing.item, item);
      existing.seq = this.stamp();
    } else {
      rows.push({ userId, seq: this.stamp(), item });
    }
  }

  remoteFor(authUserId: string): SyncRemote {
    return {
      push: async (userId, changes) => {
        this.pushCalls += 1;
        if (userId !== authUserId) throw new SyncError("auth", "RLS violation");
        if (this.failNextPush) {
          const error = this.failNextPush;
          this.failNextPush = null;
          throw error;
        }
        for (const activity of changes.activities) this.upsert(this.activities, userId, activity, mergeActivity);
        for (const baseline of changes.baselines) this.upsert(this.baselines, userId, baseline, (old) => old);
        for (const entry of changes.entries) {
          if (!this.activities.some((row) => row.userId === userId && row.item.id === entry.activityId)) {
            throw new SyncError("server", "foreign key violation");
          }
          this.upsert(this.entries, userId, entry, (old, next) => mergeEntryLists([old], [next])[0]);
        }
      },
      pull: async (userId, cursors) => {
        this.pullCalls += 1;
        const visible = <T,>(rows: Row<T>[], cursor: { updatedAt: string } | null) =>
          rows.filter((row) => row.userId === authUserId && row.userId === userId && row.seq > Number(cursor?.updatedAt ?? 0));
        const tail = <T,>(rows: Row<T>[], fallback: { updatedAt: string; id: string } | null) => {
          const max = Math.max(0, ...rows.map((row) => row.seq));
          return max > 0 ? { updatedAt: String(max), id: "" } : fallback;
        };
        const a = visible(this.activities, cursors.activities);
        const e = visible(this.entries, cursors.entries);
        const b = visible(this.baselines, cursors.baselines);
        return {
          snapshot: {
            activities: a.map((row) => ({ ...row.item })),
            entries: e.map((row) => ({ ...row.item })),
            baselines: b.map((row) => ({ ...row.item })),
          },
          cursors: { activities: tail(a, cursors.activities), entries: tail(e, cursors.entries), baselines: tail(b, cursors.baselines) },
        };
      },
    };
  }
}

const clock = { now: T0 };

function createDevice(server: FakeServer) {
  const storage = new MemoryStorage();
  let memory: TrackerState | null = null;
  let signedIn: string | null = null;
  const commit = (update: TrackerUpdate, source: "user" | "sync") => {
    const now = clock.now;
    const result = commitTrackerUpdate(storage, memory, update, now);
    memory = result.state;
    recordCommit(storage, result.base, result.state, now, { captureActivities: source === "user" });
    return result.state;
  };
  commit((base) => base, "user");
  const deps = (): SyncDeps => ({
    storage,
    remote: server.remoteFor(signedIn ?? "anon"),
    commit: (update) => commit(update, "sync"),
    now: () => clock.now,
    isCurrent: (userId) => signedIn === userId,
  });
  return {
    storage,
    commit: (update: TrackerUpdate) => commit(update, "user"),
    tap: (activityId: string) => commit((base, now) => toggleActivity(base, activityId, now), "user"),
    state: () => commit((base) => base, "sync"),
    signIn: (userId: string) => {
      signedIn = userId;
    },
    signOut: () => {
      signedIn = null;
    },
    deps,
    meta: () => loadSyncMeta(storage),
  };
}

const ADA = { userId: "user-ada", email: "ada@tapact.app" };
const BOB = { userId: "user-bob", email: "bob@tapact.app" };

function today(state: TrackerState, activityId: string): number {
  return state.dailyRecords[getDayKeyForMs(T0)]?.[activityId] ?? 0;
}

describe("merge rules", () => {
  it("unions overlapping intervals so shared time counts once", () => {
    expect(unionIntervals([
      { startMs: 0, endMs: 10 },
      { startMs: 5, endMs: 20 },
      { startMs: 30, endMs: 40 },
      { startMs: 30, endMs: 35 },
    ])).toEqual([
      { startMs: 0, endMs: 20 },
      { startMs: 30, endMs: 40 },
    ]);
  });

  it("never double-counts overlapping segments or duplicated uploads, and splits at midnight", () => {
    const day = getDayKeyForMs(T0);
    const records = computeDailyRecords({
      entries: [
        { id: "a:coding:1", activityId: "coding", deviceId: "a", startMs: T0, endMs: T0 + 30 * MIN },
        { id: "b:coding:2", activityId: "coding", deviceId: "b", startMs: T0 + 10 * MIN, endMs: T0 + 40 * MIN },
        { id: "a:gym:3", activityId: "gym", deviceId: "a", startMs: T0, endMs: T0 + 5 * MIN },
      ],
      baselines: [],
    });
    expect(records[day]).toEqual({ coding: 40 * MIN, gym: 5 * MIN });

    const lateNight = new Date(2026, 9, 12, 23, 50).getTime();
    const split = computeDailyRecords({
      entries: [{ id: "x", activityId: "coding", deviceId: "a", startMs: lateNight, endMs: lateNight + 20 * MIN }],
      baselines: [],
    });
    expect(split[day]?.coding).toBe(10 * MIN);
    expect(split[getDayKeyForMs(lateNight + 20 * MIN)]?.coding).toBe(10 * MIN);
  });

  it("sums baselines from different sources, but counts the same imported history once", () => {
    const records = computeDailyRecords({
      entries: [{ id: "e", activityId: "coding", deviceId: "a", startMs: T0, endMs: T0 + MIN }],
      baselines: [
        { id: "s1|2026-10-01|coding", sourceId: "s1", dayKey: "2026-10-01", activityId: "coding", ms: 30 * MIN },
        { id: "s2|2026-10-01|coding", sourceId: "s2", dayKey: "2026-10-01", activityId: "coding", ms: 30 * MIN },
        { id: "s3|2026-10-01|coding", sourceId: "s3", dayKey: "2026-10-01", activityId: "coding", ms: 20 * MIN },
      ],
    });
    expect(records["2026-10-01"].coding).toBe(50 * MIN);
    expect(records[getDayKeyForMs(T0)].coding).toBe(MIN);
  });

  it("resolves activity conflicts deterministically regardless of order, and archiving is sticky", () => {
    const base = { id: "coding", name: "Coding", iconKey: "brain", color: "#8B95FF", goalMinutes: 60, cue: "", archivedAtMs: null } as const;
    const older: SyncActivity = { ...base, name: "Old", updatedAtMs: 100, deviceId: "a", archivedAtMs: 50 };
    const newer: SyncActivity = { ...base, name: "New", updatedAtMs: 200, deviceId: "b" };
    expect(mergeActivity(older, newer)).toEqual(mergeActivity(newer, older));
    expect(mergeActivity(older, newer)).toMatchObject({ name: "New", archivedAtMs: 50 });
    const tieA: SyncActivity = { ...newer, name: "A", deviceId: "a" };
    const tieB: SyncActivity = { ...newer, name: "B", deviceId: "b" };
    expect(mergeActivity(tieA, tieB).name).toBe("B");
    expect(mergeActivity(tieB, tieA).name).toBe("B");
  });
});

describe("local change capture", () => {
  const owned: SyncMeta = {
    version: 1,
    deviceId: "dev",
    owner: ADA,
    floor: null,
    outboxes: [],
    lastSyncedAtMs: null,
    lastSyncedUserId: null,
  };

  it("records the exact timer segment when a commit stops the timer", () => {
    const running = toggleActivity(createDefaultTrackerState(T0), "coding", T0);
    const base = { ...running, lastProcessedMs: T0 + 25 * MIN, dailyRecords: { [getDayKeyForMs(T0)]: { coding: 25 * MIN } } };
    const next = toggleActivity(base, "coding", T0 + 25 * MIN);
    const meta = captureCommit(owned, base, next, T0 + 25 * MIN, { captureActivities: true });
    expect(getOutbox(meta, ADA.userId).entries).toEqual([
      { id: `dev:coding:${T0}`, activityId: "coding", deviceId: "dev", startMs: T0, endMs: T0 + 25 * MIN },
    ]);
  });

  it("records nothing for guest data and skips activity edits made by sync", () => {
    const base = createDefaultTrackerState(T0);
    const next = updateActivity(base, "gym", { name: "Lifting" });
    expect(captureCommit({ ...owned, owner: null }, base, next, T0, { captureActivities: true }).outboxes).toEqual([]);
    expect(captureCommit(owned, base, next, T0, { captureActivities: false }).outboxes).toEqual([]);
    const edited = getOutbox(captureCommit(owned, base, next, T0, { captureActivities: true }), ADA.userId);
    expect(edited.activities.map((item) => [item.id, item.name, item.updatedAtMs])).toEqual([["gym", "Lifting", T0]]);
  });

  it("keeps an outbox entry that grew while its upload was in flight", () => {
    const sent: SyncSnapshot = {
      activities: [],
      baselines: [],
      entries: [{ id: "e", activityId: "coding", deviceId: "dev", startMs: T0, endMs: T0 + MIN }],
    };
    const meta: SyncMeta = { ...owned, outboxes: [{ userId: ADA.userId, ...sent, entries: [{ ...sent.entries[0], endMs: T0 + 2 * MIN }] }] };
    expect(getOutbox(removeConfirmed(meta, ADA.userId, sent), ADA.userId).entries).toHaveLength(1);
    expect(getOutbox(removeConfirmed(meta, ADA.userId, { ...sent, entries: [{ ...sent.entries[0], endMs: T0 + 2 * MIN }] }), ADA.userId).entries).toHaveLength(0);
  });
});

describe("ownership decisions", () => {
  const meta: SyncMeta = { version: 1, deviceId: "d", owner: null, floor: null, outboxes: [], lastSyncedAtMs: null, lastSyncedUserId: null };
  it("never claims guest data automatically and never mixes accounts", () => {
    const fresh = createDefaultTrackerState(T0);
    const used = toggleActivity(toggleActivity(fresh, "coding", T0), "coding", T0 + MIN);
    expect(decideOwnership(meta, fresh, ADA.userId).kind).toBe("adopt-pristine");
    expect(decideOwnership(meta, used, ADA.userId).kind).toBe("guest-data");
    expect(decideOwnership({ ...meta, owner: ADA }, used, ADA.userId).kind).toBe("in-sync");
    expect(decideOwnership({ ...meta, owner: ADA }, used, BOB.userId)).toEqual({ kind: "other-account", ownerEmail: ADA.email });
  });
});

describe("sync engine", () => {
  it("imports guest history into the account without changing local totals", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    phone.tap("coding");
    clock.now = T0 + 30 * MIN;
    phone.tap("coding");
    const before = phone.state();

    phone.signIn(ADA.userId);
    expect(await runSync(phone.deps(), ADA)).toEqual({ kind: "needs-decision" });
    expect(server.pushCalls).toBe(0);

    const result = await importLocalData(phone.deps(), ADA);
    expect(result.kind).toBe("synced");
    const after = phone.state();
    expect(after.dailyRecords).toEqual(before.dailyRecords);
    expect(server.baselines.map((row) => row.item.ms)).toEqual([30 * MIN]);
    expect(server.baselines.every((row) => row.userId === ADA.userId)).toBe(true);
  });

  it("keeps a timer running through import without counting its earlier time twice", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    phone.tap("coding");
    clock.now = T0 + 10 * MIN;
    phone.signIn(ADA.userId);
    await importLocalData(phone.deps(), ADA);
    clock.now = T0 + 25 * MIN;
    phone.tap("coding");
    await runSync(phone.deps(), ADA);
    expect(today(phone.state(), "coding")).toBe(25 * MIN);

    const laptop = createDevice(server);
    laptop.signIn(ADA.userId);
    await adoptAccount(laptop.deps(), ADA, { keepCurrent: false });
    expect(today(laptop.state(), "coding")).toBe(25 * MIN);
  });

  it("merges two devices tracking at the same time without double-counting the overlap", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    const laptop = createDevice(server);
    phone.signIn(ADA.userId);
    laptop.signIn(ADA.userId);
    await adoptAccount(phone.deps(), ADA, { keepCurrent: false });
    await adoptAccount(laptop.deps(), ADA, { keepCurrent: false });

    phone.tap("coding");
    clock.now = T0 + 10 * MIN;
    laptop.tap("coding");
    clock.now = T0 + 30 * MIN;
    phone.tap("coding");
    clock.now = T0 + 40 * MIN;
    laptop.tap("coding");
    laptop.tap("gym");
    clock.now = T0 + 45 * MIN;
    laptop.tap("gym");

    await runSync(phone.deps(), ADA);
    await runSync(laptop.deps(), ADA);
    await runSync(phone.deps(), ADA);

    for (const device of [phone, laptop]) {
      const state = device.state();
      expect(today(state, "coding")).toBe(40 * MIN);
      expect(today(state, "gym")).toBe(5 * MIN);
      expect(getDayTotalElapsed(state, getDayKeyForMs(T0))).toBe(45 * MIN);
    }
  });

  it("keeps unconfirmed changes after a failed upload and stays idempotent on retry", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    phone.signIn(ADA.userId);
    await adoptAccount(phone.deps(), ADA, { keepCurrent: false });
    phone.tap("gym");
    clock.now = T0 + 20 * MIN;
    phone.tap("gym");

    server.failNextPush = new SyncError("offline", "network");
    await expect(runSync(phone.deps(), ADA)).rejects.toThrow();
    expect(getOutbox(phone.meta(), ADA.userId).entries).toHaveLength(1);
    expect(phone.meta().lastSyncedAtMs).not.toBe(T0 + 20 * MIN);

    await runSync(phone.deps(), ADA);
    await runSync(phone.deps(), ADA);
    expect(getOutbox(phone.meta(), ADA.userId).entries).toHaveLength(0);
    expect(server.entries).toHaveLength(1);
    expect(today(phone.state(), "gym")).toBe(20 * MIN);
  });

  it("applies the newest activity edit and sticky archive across devices", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    const laptop = createDevice(server);
    for (const device of [phone, laptop]) {
      device.signIn(ADA.userId);
      await adoptAccount(device.deps(), ADA, { keepCurrent: false });
    }
    clock.now = T0 + MIN;
    phone.commit((base) => updateActivity(base, "reading", { goalMinutes: 15 }));
    clock.now = T0 + 2 * MIN;
    laptop.commit((base) => updateActivity(base, "reading", { goalMinutes: 90 }));
    laptop.commit((base, now) => archiveActivity(base, "gym", now));
    clock.now = T0 + 3 * MIN;
    phone.commit((base) => updateActivity(base, "gym", { name: "Gym time" }));

    await runSync(laptop.deps(), ADA);
    await runSync(phone.deps(), ADA);
    await runSync(laptop.deps(), ADA);
    for (const device of [phone, laptop]) {
      const activities = device.state().activities;
      expect(activities.find((item) => item.id === "reading")?.goalMinutes).toBe(90);
      expect(activities.find((item) => item.id === "gym")).toMatchObject({ name: "Gym time", archivedAtMs: T0 + 2 * MIN });
    }
  });

  it("never uploads one account's data to another and sets it aside on switch", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const shared = createDevice(server);
    shared.signIn(ADA.userId);
    await adoptAccount(shared.deps(), ADA, { keepCurrent: false });
    shared.tap("reading");
    clock.now = T0 + 15 * MIN;
    shared.tap("reading");
    await runSync(shared.deps(), ADA);

    shared.signOut();
    shared.signIn(BOB.userId);
    const decision = decideOwnership(shared.meta(), shared.state(), BOB.userId);
    expect(decision.kind).toBe("other-account");
    expect(await runSync(shared.deps(), BOB)).toEqual({ kind: "needs-decision" });
    await expect(importLocalData(shared.deps(), BOB)).rejects.toThrow();

    await adoptAccount(shared.deps(), BOB, { keepCurrent: true });
    expect(today(shared.state(), "reading")).toBe(0);
    expect(server.entries.filter((row) => row.userId === BOB.userId)).toHaveLength(0);
    expect(server.baselines.filter((row) => row.userId === BOB.userId)).toHaveLength(0);
    const stash = loadStash(shared.storage, clock.now);
    expect(stash).toHaveLength(1);
    expect(stash[0].ownerUserId).toBe(ADA.userId);

    shared.signOut();
    shared.signIn(ADA.userId);
    await adoptAccount(shared.deps(), ADA, { keepCurrent: true });
    expect(today(shared.state(), "reading")).toBe(15 * MIN);
    expect(loadStash(shared.storage, clock.now).map((item) => item.ownerUserId)).toEqual([BOB.userId]);
  });

  it("rejects a forged upload for another user and drops results if the account changes mid-sync", async () => {
    const server = new FakeServer();
    await expect(
      server.remoteFor(BOB.userId).push(ADA.userId, { activities: [], entries: [], baselines: [] }),
    ).rejects.toThrow();

    clock.now = T0;
    const phone = createDevice(server);
    phone.signIn(ADA.userId);
    await adoptAccount(phone.deps(), ADA, { keepCurrent: false });
    const deps = phone.deps();
    const aborted = await runSync({ ...deps, isCurrent: () => false }, ADA);
    expect(aborted).toEqual({ kind: "aborted" });
  });

  it("detaches account data before a backup restore so the file is never uploaded unasked", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    phone.signIn(ADA.userId);
    await adoptAccount(phone.deps(), ADA, { keepCurrent: false });
    const deps = phone.deps();
    detachForRestore(deps);
    phone.commit((base) => addActivity({ ...base }, { id: "restored", name: "Restored", iconKey: "book", color: "#7EC8F8", goalMinutes: null, cue: "x" }));
    expect(phone.meta().owner).toBeNull();
    expect(decideOwnership(phone.meta(), phone.state(), ADA.userId).kind).toBe("guest-data");
    expect(await runSync(deps, ADA)).toEqual({ kind: "needs-decision" });
    expect(server.activities.some((row) => row.item.id === "restored")).toBe(false);
  });

  it("keeps guest data aside untouched when the user picks account data only", async () => {
    clock.now = T0;
    const server = new FakeServer();
    const phone = createDevice(server);
    phone.tap("coding");
    clock.now = T0 + 5 * MIN;
    phone.tap("coding");
    phone.signIn(ADA.userId);
    await adoptAccount(phone.deps(), ADA, { keepCurrent: true });
    const stash = loadStash(phone.storage, clock.now);
    expect(stash).toHaveLength(1);
    expect(stash[0].ownerUserId).toBeNull();
    expect(today(stash[0].tracker, "coding")).toBe(5 * MIN);
    expect(server.baselines).toHaveLength(0);
    expect(server.entries).toHaveLength(0);
    expect(saveSyncMeta(phone.storage, phone.meta())).toBe(true);
  });
});
