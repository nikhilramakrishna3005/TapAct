"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AccountSummary, summarizeUser } from "@/lib/auth/account";
import { releaseDevicePushSubscription } from "@/lib/push/browser";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthStatus = "loading" | "signed-in" | "signed-out" | "unavailable";

type AuthValue = {
  status: AuthStatus;
  account: AccountSummary | null;
  /** Clears only the auth session. Local tracking data is never touched. */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<AccountSummary | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("unavailable");
      return;
    }
    let cancelled = false;
    const apply = (user: Parameters<typeof summarizeUser>[0] | null | undefined) => {
      if (cancelled) {
        return;
      }
      setAccount(user ? summarizeUser(user) : null);
      setStatus(user ? "signed-in" : "signed-out");
    };

    // The stored session restores instantly and offline; Supabase refreshes it in the background.
    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session?.user))
      .catch(() => apply(null));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user));
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }
    try {
      await releaseDevicePushSubscription();
      // Supabase removes the local session even if the network call fails.
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      setAccount(null);
      setStatus("signed-out");
    }
  }, []);

  const value = useMemo(() => ({ status, account, signOut }), [account, signOut, status]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
