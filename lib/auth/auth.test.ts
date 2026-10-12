import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { getInitials, summarizeUser } from "./account";
import { classifyAuthError, describeAuthError, describeCallbackError, NETWORK_ERROR_MESSAGE } from "./errors";
import { buildConfirmUrl, RESET_PASSWORD_PATH, safeNextPath } from "./redirect";
import {
  getPasswordStrength,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validateSignInPassword,
} from "./validation";
import { parseSupabaseConfig } from "../supabase/config";

describe("safeNextPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/?tab=settings")).toBe("/?tab=settings");
    expect(safeNextPath(RESET_PASSWORD_PATH)).toBe(RESET_PASSWORD_PATH);
    expect(safeNextPath("/history#today")).toBe("/history#today");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "%2F%2Fevil.com",
    "/%2F/evil.com",
    "/%5Cevil.com",
    "javascript:alert(1)",
    "evil.com/path",
    "/\tevil",
    "/x\n",
    `/${"a".repeat(600)}`,
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("builds a confirm URL with a sanitized next path", () => {
    const url = new URL(buildConfirmUrl("https://tap-act.vercel.app", "//evil.com"));
    expect(url.origin).toBe("https://tap-act.vercel.app");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("next")).toBe("/");
    const reset = new URL(buildConfirmUrl("https://tap-act.vercel.app", RESET_PASSWORD_PATH));
    expect(reset.searchParams.get("next")).toBe(RESET_PASSWORD_PATH);
  });
});

describe("validation", () => {
  it("validates email", () => {
    expect(validateEmail("")).toMatch(/enter your email/i);
    expect(validateEmail("nope")).toMatch(/valid email/i);
    expect(validateEmail("a@b")).toMatch(/valid email/i);
    expect(validateEmail("  me@tapact.app ")).toBeNull();
  });

  it("validates name", () => {
    expect(validateName("   ")).toMatch(/enter your name/i);
    expect(validateName("x".repeat(51))).toMatch(/under 50/);
    expect(validateName("Ada")).toBeNull();
  });

  it("validates passwords", () => {
    expect(validateSignInPassword("")).toMatch(/enter your password/i);
    expect(validateSignInPassword("short")).toBeNull();
    expect(validateNewPassword("")).toMatch(/create a password/i);
    expect(validateNewPassword("abc1")).toMatch(/at least 8/);
    expect(validateNewPassword("abcdefgh")).toMatch(/letter and one number/);
    expect(validateNewPassword("12345678")).toMatch(/letter and one number/);
    expect(validateNewPassword("a1".repeat(40))).toMatch(/at most 72/);
    expect(validateNewPassword("orbit2026")).toBeNull();
    expect(validatePasswordConfirmation("orbit2026", "")).toMatch(/confirm/i);
    expect(validatePasswordConfirmation("orbit2026", "orbit2025")).toMatch(/don't match/);
    expect(validatePasswordConfirmation("orbit2026", "orbit2026")).toBeNull();
  });

  it("scores password strength", () => {
    expect(getPasswordStrength("").score).toBe(0);
    expect(getPasswordStrength("abc").score).toBe(1);
    expect(getPasswordStrength("Orbit-2026-Electric").score).toBe(4);
  });
});

describe("auth errors", () => {
  it("classifies and describes common errors without echoing server text", () => {
    expect(classifyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      "invalid-credentials",
    );
    expect(classifyAuthError({ message: "Email not confirmed" })).toBe("email-not-confirmed");
    expect(classifyAuthError({ status: 429, message: "x" })).toBe("rate-limited");
    expect(classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" })).toBe("network");
    expect(describeAuthError(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE);
    expect(describeAuthError({ code: "weird", message: "<script>" })).toBe("Something went wrong. Please try again.");
  });

  it("describes callback error codes", () => {
    expect(describeCallbackError(null)).toBeNull();
    expect(describeCallbackError("link_expired")).toMatch(/expired/);
    expect(describeCallbackError("anything")).toMatch(/couldn't be verified/);
  });
});

describe("account summary", () => {
  const user = {
    id: "u1",
    email: "ada@tapact.app",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    user_metadata: { display_name: "  Ada Lovelace " },
  } as unknown as User;

  it("summarizes a user", () => {
    expect(summarizeUser(user)).toEqual({
      id: "u1",
      email: "ada@tapact.app",
      displayName: "Ada Lovelace",
      emailVerified: true,
    });
    expect(summarizeUser({ ...user, email_confirmed_at: undefined, user_metadata: {} } as User)).toMatchObject({
      displayName: null,
      emailVerified: false,
    });
  });

  it("derives initials", () => {
    expect(getInitials({ displayName: "Ada Lovelace", email: null })).toBe("AL");
    expect(getInitials({ displayName: null, email: "ada.l@tapact.app" })).toBe("A");
    expect(getInitials({ displayName: null, email: null })).toBe("?");
  });
});

describe("supabase config", () => {
  it("returns null for missing or malformed values", () => {
    expect(parseSupabaseConfig(undefined, "key")).toBeNull();
    expect(parseSupabaseConfig("https://x.supabase.co", "")).toBeNull();
    expect(parseSupabaseConfig("not a url", "key")).toBeNull();
    expect(parseSupabaseConfig("ftp://x.supabase.co", "key")).toBeNull();
    expect(parseSupabaseConfig("https://x.supabase.co", "sb_publishable_x")).toEqual({
      url: "https://x.supabase.co",
      publishableKey: "sb_publishable_x",
    });
  });
});
