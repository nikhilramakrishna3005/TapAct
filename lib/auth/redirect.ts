export const DEFAULT_NEXT_PATH = "/";

/**
 * Only same-origin, absolute paths are allowed as post-auth destinations. Anything
 * that could resolve to another origin (`//evil.com`, `/\evil.com`, `https://…`,
 * encoded variants, control characters) falls back to the home screen.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = DEFAULT_NEXT_PATH): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return fallback;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
      return fallback;
    }
    if (/[\u0000-\u001f\u007f\\]/.test(candidate)) {
      return fallback;
    }
  }
  try {
    const base = "https://tapact.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Builds the `/auth/confirm` callback URL that Supabase email links return to. */
export function buildConfirmUrl(siteUrl: string, next: string): string {
  const url = new URL("/auth/confirm", siteUrl);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

export const RESET_PASSWORD_PATH = "/auth?mode=reset";
