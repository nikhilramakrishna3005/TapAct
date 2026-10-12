export type SupabaseConfig = { url: string; publishableKey: string };

/**
 * Reads the public Supabase settings. Both values are safe to ship to the browser;
 * no service-role or secret key is ever read by this app. Returns null when either
 * value is missing or malformed so the app can run in guest-only mode.
 */
export function getSupabaseConfig(): SupabaseConfig | null {
  // Referenced literally so Next.js inlines them into the client bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  return parseSupabaseConfig(url, publishableKey);
}

export function parseSupabaseConfig(url: string | undefined, publishableKey: string | undefined): SupabaseConfig | null {
  if (!url || !publishableKey) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
  } catch {
    return null;
  }
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/** Where email links should land. Prefers an explicit production URL when one is set. */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Fall through to the current origin.
    }
  }
  return typeof window === "undefined" ? "https://tap-act.vercel.app" : window.location.origin;
}
