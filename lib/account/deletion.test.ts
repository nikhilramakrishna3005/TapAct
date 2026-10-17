import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deletionOutcome } from "./deletionOutcome";
import { expiredCookieAssignments, supabaseAuthCookieNames } from "./localSession";
import { authDeletionAlreadyDone, deletionOriginAllowed, emailsMatch, performAccountDeletion, signedInRecently, type DeletionDeps } from "./deletion";

const NOW = Date.parse("2026-10-15T18:00:00.000Z");

function deps(overrides: Partial<DeletionDeps> = {}): DeletionDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    enabled: true,
    now: () => NOW,
    getUser: async () => ({
      id: "user-ada",
      email: "ada@example.test",
      lastSignInAt: new Date(NOW - 60_000).toISOString(),
    }),
    prepare: async () => {
      calls.push("prepare");
    },
    deleteAuthUser: async (userId) => {
      calls.push(`delete:${userId}`);
    },
    ...overrides,
  };
}

describe("account deletion route decisions", () => {
  it("rejects a signed-out caller before preparation", async () => {
    const harness = deps({ getUser: async () => null });
    const result = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
    expect(harness.calls).toEqual([]);
  });

  it("ignores a user id supplied in the body", async () => {
    const harness = deps();
    const result = await performAccountDeletion(
      { email: "ada@example.test", confirm: true, userId: "user-bo" },
      harness,
    );
    expect(result).toEqual({ ok: true });
    expect(harness.calls).toEqual(["prepare", "delete:user-ada"]);
  });

  it("rejects the wrong email and a missing confirmation", async () => {
    const harness = deps();
    expect(await performAccountDeletion({ email: "bo@example.test", confirm: true }, harness)).toMatchObject({ code: "email" });
    expect(await performAccountDeletion({ email: "ada@example.test", confirm: false }, harness)).toMatchObject({ code: "confirm" });
    expect(harness.calls).toEqual([]);
  });

  it("treats a refreshed session with an old sign-in as stale", async () => {
    const harness = deps({
      getUser: async () => ({
        id: "user-ada",
        email: "ada@example.test",
        lastSignInAt: new Date(NOW - 11 * 60_000).toISOString(),
      }),
    });
    const result = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(result).toMatchObject({ ok: false, code: "reauth" });
    expect(harness.calls).toEqual([]);
    expect(signedInRecently(new Date(NOW - 11 * 60_000).toISOString(), NOW)).toBe(false);
    expect(emailsMatch("  Ada@Example.Test ", "ada@example.test")).toBe(true);
  });

  it("prepares before Auth deletion and reports success only after both", async () => {
    const harness = deps();
    expect(await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness)).toEqual({ ok: true });
    expect(harness.calls).toEqual(["prepare", "delete:user-ada"]);
  });

  it("does not call Auth deletion when preparation fails", async () => {
    const harness = deps({
      prepare: async () => {
        throw new Error("Could not find the function tapact_prepare_account_deletion");
      },
    });
    const result = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect(harness.calls).toEqual([]);
  });

  it("keeps a retryable failure when Auth deletion fails after preparation", async () => {
    const harness = deps({
      deleteAuthUser: async () => {
        throw new Error("admin down");
      },
    });
    const result = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(result).toMatchObject({ ok: false, code: "retry" });
    expect(result.ok ? "" : result.message).not.toContain("admin down");
    expect(harness.calls).toEqual(["prepare"]);
  });

  it("can be retried after a partial completion without reporting success early", async () => {
    let prepared = false;
    const harness = deps({
      prepare: async () => {
        prepared = true;
      },
      deleteAuthUser: async (userId) => {
        if (!prepared) throw new Error("too soon");
        harness.calls.push(`delete:${userId}`);
        if (harness.calls.length === 1) throw new Error("network");
      },
    });
    const first = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(first).toMatchObject({ code: "retry" });
    const second = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(second).toEqual({ ok: true });
  });

  it("treats an Auth user that is already gone as deleted without preparing it again", async () => {
    const harness = deps({
      getUser: async () => {
        throw new Error("already-deleted");
      },
    });
    const result = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(result).toEqual({ ok: true });
    expect(harness.calls).toEqual([]);
    expect(authDeletionAlreadyDone({ status: 404, message: "User not found" })).toBe(true);
    expect(authDeletionAlreadyDone({ status: 500, message: "admin down" })).toBe(false);
  });

  it("accepts only this site's Origin on the deletion POST", () => {
    expect(deletionOriginAllowed("https://staging.example.test/api/account/deletion", "https://staging.example.test")).toBe(true);
    expect(deletionOriginAllowed("https://staging.example.test/api/account/deletion", "https://evil.example")).toBe(false);
    expect(deletionOriginAllowed("https://staging.example.test/api/account/deletion", null)).toBe(false);
    expect(deletionOriginAllowed("http://internal/", "https://staging.example.test", "staging.example.test")).toBe(true);
  });

  it("keeps server deletion distinct from device cleanup", () => {
    const cleaned = deletionOutcome({ serverDeleted: true, deviceCleaned: true, signedOut: true, serverMessage: null });
    const localFailure = deletionOutcome({
      serverDeleted: true,
      deviceCleaned: false,
      signedOut: false,
      serverMessage: "Couldn't delete the account. Check your connection and try again.",
    });
    const signOutFailure = deletionOutcome({ serverDeleted: true, deviceCleaned: true, signedOut: false, serverMessage: null });
    expect(cleaned.allowServerRetry).toBe(false);
    expect(cleaned.allowPassword).toBe(false);
    expect(cleaned.title).toBe("Your account has been deleted.");
    expect(localFailure.title).toBe("Your account has been deleted.");
    expect(localFailure.allowServerRetry).toBe(false);
    expect(localFailure.allowPassword).toBe(false);
    expect(localFailure.detail).not.toMatch(/still exists|sign in again|Couldn't delete/i);
    expect(localFailure.detail).toContain("Clear");
    expect(signOutFailure.allowServerRetry).toBe(false);
    expect(signOutFailure.allowPassword).toBe(false);
    expect(signOutFailure.detail).toContain("Finish signing out");
    expect(signOutFailure.detail).not.toMatch(/still exists|sign in again/i);
    expect(supabaseAuthCookieNames("sb-abc-auth-token=1; theme=dark; sb-abc-auth-token.0=2")).toEqual([
      "sb-abc-auth-token",
      "sb-abc-auth-token.0",
    ]);
    expect(expiredCookieAssignments(["sb-abc-auth-token"])).toEqual(["sb-abc-auth-token=; Max-Age=0; path=/"]);
  });

  it("stays off unless the server flag is enabled", async () => {
    let read = false;
    const harness = deps({
      enabled: false,
      getUser: async () => {
        read = true;
        return null;
      },
    });
    const result = await performAccountDeletion({ email: "ada@example.test", confirm: true }, harness);
    expect(result).toMatchObject({ code: "unavailable" });
    expect(read).toBe(false);
  });

  it("checks the Auth user record and keeps the service role on the server", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/account/deletion/route.ts"), "utf8");
    const screen = readFileSync(resolve(process.cwd(), "app/components/DeleteAccount.tsx"), "utf8");
    expect(route).toContain("auth.getUser()");
    expect(route.indexOf("auth.getUser()")).toBeLessThan(route.indexOf(".getSession("));
    expect(route).toContain("deletionOriginAllowed");
    expect(route).toContain("private, no-store");
    expect(route).toContain("getUserById");
    expect(route).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(route).toContain("auth.admin.deleteUser");
    expect(screen).not.toContain("SERVICE_ROLE");
    expect(screen).toContain("JSON.stringify({ email: typedEmail, confirm: confirmed })");
    expect(screen).toContain("disabled={pending");
    expect(screen).toContain("Deleting account…");
    expect(screen).toContain("Account deletion is not available yet");
    expect(screen).toContain("Clear this device");
    expect(screen).toContain("Finish signing out");
    const afterServerSuccess = screen.slice(screen.indexOf("serverDeleted = true"));
    expect(afterServerSuccess).not.toContain("signInWithPassword");
    expect(afterServerSuccess).not.toContain("/api/account/deletion");
  });
});
