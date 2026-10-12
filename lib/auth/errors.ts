export const NETWORK_ERROR_MESSAGE =
  "Can't reach TapAct accounts right now. Check your connection. You can keep tracking as a guest.";

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; name?: unknown };

export type AuthErrorKind = "invalid-credentials" | "email-not-confirmed" | "rate-limited" | "network" | "other";

export function classifyAuthError(error: unknown): AuthErrorKind {
  const candidate = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const name = typeof candidate.name === "string" ? candidate.name : "";

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "invalid-credentials";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "email-not-confirmed";
  }
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    candidate.status === 429 ||
    message.includes("rate limit")
  ) {
    return "rate-limited";
  }
  if (
    name === "AuthRetryableFetchError" ||
    name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed")
  ) {
    return "network";
  }
  return "other";
}

/** Maps Supabase Auth errors to calm, specific copy without echoing raw server text. */
export function describeAuthError(error: unknown): string {
  const candidate = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";

  switch (classifyAuthError(error)) {
    case "invalid-credentials":
      return "That email and password don't match. Check them and try again.";
    case "email-not-confirmed":
      return "Confirm your email first. We can send the verification link again.";
    case "rate-limited":
      return "Too many attempts. Wait a minute, then try again.";
    case "network":
      return NETWORK_ERROR_MESSAGE;
    default:
      break;
  }
  switch (code) {
    case "weak_password":
      return "Choose a stronger password with letters and numbers.";
    case "same_password":
      return "Choose a password you haven't used for this account.";
    case "signup_disabled":
      return "New accounts are temporarily unavailable. Continue as a guest for now.";
    case "email_address_invalid":
      return "That email address can't be used. Try a different one.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
      return "Your reset link has expired. Request a new one.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Messages for `?error=` codes set by the `/auth/confirm` callback. */
export function describeCallbackError(code: string | null): string | null {
  switch (code) {
    case null:
    case "":
      return null;
    case "link_expired":
      return "That link has expired or was already used. Request a new one below.";
    case "link_other_browser":
      return "That link was opened in a different browser than the one you used. If you just confirmed your email, sign in below.";
    case "unavailable":
      return "Accounts aren't available right now. You can keep tracking as a guest.";
    default:
      return "That link couldn't be verified. Please try again.";
  }
}
