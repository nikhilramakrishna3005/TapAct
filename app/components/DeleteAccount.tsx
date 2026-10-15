"use client";

import { useEffect, useState } from "react";
import { deletionOutcome, type DeletionOutcome } from "@/lib/account/deletionOutcome";
import { normalizeEmail } from "@/lib/auth/validation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import { useCloudSync } from "./CloudSync";

type Availability = "loading" | "off" | "on";

export function DeleteAccount({
  email,
  userId,
  onDeleted,
}: {
  email: string | null;
  userId: string;
  onDeleted: (result: { userId: string; deviceCleaned: boolean }) => void;
}) {
  const auth = useAuth();
  const sync = useCloudSync();
  const [availability, setAvailability] = useState<Availability>("loading");
  const [typedEmail, setTypedEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DeletionOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/deletion")
      .then((response) => response.json())
      .then((body: { enabled?: boolean }) => {
        if (!cancelled) setAvailability(body.enabled ? "on" : "off");
      })
      .catch(() => {
        if (!cancelled) setAvailability("off");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const settleLocally = async (deviceCleaned: boolean, signedOut: boolean) => {
    const next = deletionOutcome({ serverDeleted: true, deviceCleaned, signedOut, serverMessage: null });
    setOutcome(next);
    if (signedOut) onDeleted({ userId, deviceCleaned });
  };

  const clearThisDevice = async () => {
    if (pending) return;
    setPending(true);
    const progress = sync.applyLocalDeletion(userId);
    let signedOut = outcome?.signedOut ?? false;
    if (!signedOut) {
      try {
        signedOut = await auth.signOut();
      } catch {
        signedOut = false;
      }
    }
    await settleLocally(progress.deviceCleaned, signedOut);
    setPending(false);
  };

  const finishSigningOut = async () => {
    if (pending) return;
    setPending(true);
    let signedOut = false;
    try {
      signedOut = await auth.signOut();
    } catch {
      signedOut = false;
    }
    await settleLocally(outcome?.deviceCleaned ?? false, signedOut);
    setPending(false);
  };

  const submit = async () => {
    if (pending || availability !== "on" || outcome?.serverDeleted) return;
    setPending(true);
    setError(null);
    let serverDeleted = false;
    try {
      if (needsReauth) {
        const supabase = getSupabaseBrowserClient();
        if (!supabase || !email) {
          setError("Sign in again from the sign-in screen, then come back and confirm deletion.");
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizeEmail(email),
          password,
        });
        if (signInError) {
          setError("That password didn't match. Sign in again, then confirm deletion.");
          return;
        }
      }

      const response = await fetch("/api/account/deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: typedEmail, confirm: confirmed }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string } | null;
      if (!response.ok || !body?.ok) {
        if (body?.code === "reauth") setNeedsReauth(true);
        setError(body?.error ?? "Couldn't delete the account. Try again.");
        return;
      }
      serverDeleted = true;
      const progress = sync.applyLocalDeletion(userId);
      let signedOut = false;
      try {
        signedOut = await auth.signOut();
      } catch {
        signedOut = false;
      }
      await settleLocally(progress.deviceCleaned, signedOut);
    } catch {
      if (serverDeleted) {
        await settleLocally(false, false);
        return;
      }
      setError("Couldn't delete the account. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-text-1">Delete account</h3>
      {availability === "loading" && <p className="mt-2 text-[0.72rem] text-text-3">Checking whether account deletion is available.</p>}
      {availability === "off" && (
        <p className="mt-2 text-[0.72rem] leading-relaxed text-text-3">
          Account deletion is not available yet. It stays off until the database update is applied and the full deletion flow has been checked.
        </p>
      )}
      {availability === "on" && outcome?.serverDeleted && (
        <div className="mt-2 space-y-3">
          <p role="status" className="text-[0.72rem] leading-relaxed text-text-1">
            {outcome.title} {outcome.detail}
          </p>
          {!outcome.deviceCleaned && (
            <button type="button" onClick={() => void clearThisDevice()} disabled={pending} className="btn btn-ghost h-12 w-full">
              {pending ? "Clearing this device…" : "Clear this device"}
            </button>
          )}
          {outcome.deviceCleaned && !outcome.signedOut && (
            <button type="button" onClick={() => void finishSigningOut()} disabled={pending} className="btn btn-ghost h-12 w-full">
              {pending ? "Signing out…" : "Finish signing out"}
            </button>
          )}
        </div>
      )}
      {availability === "on" && !outcome?.serverDeleted && (
        <form
          className="mt-2 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-[0.72rem] leading-relaxed text-text-2">
            This permanently deletes your sign-in and the personal data stored for this account. It cannot be undone.
          </p>
          <div className="text-[0.72rem] leading-relaxed text-text-3">
            <p className="font-medium text-text-2">Removed</p>
            <p>Your sign-in, synced activities and sessions, push subscriptions, notification preferences, private notification inbox, and duel character.</p>
            <p className="mt-2 font-medium text-text-2">May remain for an opponent</p>
            <p>
              A shared duel can stay, labeled Former member, with that score frozen. The time zone saved for the duel stays so the recap still adds up.
              Their own history is not deleted. A notification already delivered to a device cannot be recalled.
            </p>
          </div>
          <label className="block text-[0.72rem] font-medium text-text-2" htmlFor="delete-account-email">
            Type the email on this account
            <input
              id="delete-account-email"
              type="email"
              autoComplete="email"
              value={typedEmail}
              disabled={pending}
              onChange={(event) => setTypedEmail(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-line-strong bg-ink-0 px-3 text-sm text-text-1"
            />
          </label>
          <label className="flex items-start gap-2 text-[0.72rem] leading-relaxed text-text-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmed}
              disabled={pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand this permanently deletes my account and cannot be undone.
          </label>
          {needsReauth && (
            <label className="block text-[0.72rem] font-medium text-text-2" htmlFor="delete-account-password">
              Sign in again. A refreshed session is not a new sign-in.
              <input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-line-strong bg-ink-0 px-3 text-sm text-text-1"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-[0.72rem] leading-relaxed text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !confirmed || typedEmail.trim().length === 0}
            aria-busy={pending}
            className="btn btn-ghost h-12 w-full text-danger disabled:opacity-50"
          >
            {pending ? "Deleting account…" : "Delete account"}
          </button>
          <p className="text-[0.68rem] leading-relaxed text-text-3">
            Deletion is not finished until this screen says the account has been deleted. If sign-in removal fails, sign in again and retry. The retry does not restore data already prepared for deletion.
          </p>
        </form>
      )}
    </div>
  );
}
