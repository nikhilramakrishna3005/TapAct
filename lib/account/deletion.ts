/**
 * A valid access token only proves the session was issued. Supabase does not
 * move last_sign_in_at when it refreshes that token, so a refreshed session is
 * not a new sign-in. The timestamp must come from Auth's user record.
 */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

export type DeletionCode = "unavailable" | "unauthorized" | "reauth" | "email" | "confirm" | "prepare" | "retry";

export type DeletionResult =
  | { ok: true }
  | { ok: false; status: number; code: DeletionCode; message: string };

export type AuthenticatedAccount = {
  id: string;
  email: string | null;
  lastSignInAt: string | null;
};

export type DeletionDeps = {
  enabled: boolean;
  now: () => number;
  getUser: () => Promise<AuthenticatedAccount | null>;
  prepare: (email: string) => Promise<void>;
  deleteAuthUser: (userId: string) => Promise<void>;
};

const COPY = {
  unavailable: "Account deletion is not available yet.",
  unauthorized: "Sign in to delete your account.",
  reauth: "Sign in again, then confirm deletion.",
  email: "Enter the email on this account.",
  confirm: "Confirm that you want to permanently delete this account.",
  prepare: "Couldn't prepare the account for deletion. Nothing was removed. Try again.",
  retry: "Sign-in removal did not finish. Sign in again and retry. Your personal data stays prepared for deletion and is not restored.",
} as const;

function fail(status: number, code: DeletionCode): DeletionResult {
  return { ok: false, status, code, message: COPY[code] };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function prepareFailure(error: unknown): DeletionResult {
  const text = errorText(error);
  if (text === "unavailable" || /could not find the function|schema cache|does not exist/i.test(text)) {
    return fail(503, "unavailable");
  }
  if (/enter the email/i.test(text)) return fail(400, "email");
  if (/sign in again/i.test(text)) return fail(401, "reauth");
  if (/sign in to delete/i.test(text)) return fail(401, "unauthorized");
  return fail(500, "prepare");
}

export function emailsMatch(typed: string, accountEmail: string | null): boolean {
  const left = typed.trim().toLowerCase();
  const right = (accountEmail ?? "").trim().toLowerCase();
  return left.length > 0 && left.length <= 320 && left === right;
}

export function signedInRecently(lastSignInAt: string | null, nowMs: number): boolean {
  if (!lastSignInAt) return false;
  const signedIn = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedIn)) return false;
  return nowMs - signedIn <= REAUTH_WINDOW_MS && signedIn <= nowMs + 60_000;
}

/**
 * Deletes the authenticated account. The user id always comes from getUser().
 * Auth admin deletion runs only after preparation resolves, and success is
 * returned only after that admin call resolves.
 */
export async function performAccountDeletion(body: unknown, deps: DeletionDeps): Promise<DeletionResult> {
  if (!deps.enabled) return fail(503, "unavailable");

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (record.confirm !== true) return fail(400, "confirm");
  if (typeof record.email !== "string") return fail(400, "email");

  const account = await deps.getUser();
  if (!account?.id) return fail(401, "unauthorized");
  if (!emailsMatch(record.email, account.email)) return fail(400, "email");
  if (!signedInRecently(account.lastSignInAt, deps.now())) return fail(401, "reauth");

  try {
    await deps.prepare(record.email.trim());
  } catch (error) {
    return prepareFailure(error);
  }

  try {
    await deps.deleteAuthUser(account.id);
  } catch {
    return fail(503, "retry");
  }
  return { ok: true };
}
