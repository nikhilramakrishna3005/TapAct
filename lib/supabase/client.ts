import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

/** Browser singleton; null when Supabase isn't configured so callers fall back to guest mode. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (browserClient) {
    return browserClient;
  }
  const config = getSupabaseConfig();
  if (!config || typeof window === "undefined") {
    return null;
  }
  try {
    browserClient = createBrowserClient(config.url, config.publishableKey);
  } catch {
    return null;
  }
  return browserClient;
}
