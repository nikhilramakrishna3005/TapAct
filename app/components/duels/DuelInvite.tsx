"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deviceTimeZone, duelError, type InvitePreview } from "@/lib/duels/api";
import { duelsApi } from "@/lib/duels/api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "../AuthProvider";
import { OrbitMark } from "../Orbit";

export function DuelInvite({ token }: { token: string }) {
  const auth = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = `/auth?next=${encodeURIComponent(`/duel/${token}`)}`;

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Duels need TapAct cloud sign-in, which isn't configured here.");
      return;
    }
    let cancelled = false;
    duelsApi.preview(client, token).then((result) => {
      if (!cancelled) setPreview(result);
    }).catch((caught) => {
      if (!cancelled) setError(duelError(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const respond = async (kind: "accept" | "decline") => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "accept") {
        const result = await duelsApi.accept(client, token, deviceTimeZone());
        window.location.assign(`/?tab=duels&duel=${result.duelId}`);
        return;
      }
      await duelsApi.decline(client, token);
      setPreview((current) => (current ? { ...current, state: "revoked" } : current));
    } catch (caught) {
      setError(duelError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] px-5 py-8 text-text-1">
      <div className="flex items-center gap-2">
        <OrbitMark size={18} />
        <p className="eyebrow">Duel invite</p>
      </div>
      {!preview && !error && <p className="mt-8 text-sm text-text-3">Loading invite…</p>}
      {error && <p role="alert" className="mt-8 text-sm text-danger">{error}</p>}
      {preview?.state === "invalid" && <p className="mt-8 text-sm text-text-2">This invite link is not valid.</p>}
      {preview && preview.state !== "invalid" && (
        <section className="panel mt-6 px-4 py-4">
          <h1 className="display text-[1.7rem]">{preview.title}</h1>
          <p className="mt-2 text-sm text-text-2">{preview.inviter} invited you to a {preview.durationDays}-day duel starting {preview.startsOn}.</p>
          <ul className="mt-4 space-y-1 text-sm text-text-1">
            {preview.activities?.map((activity) => (
              <li key={activity.name}>{activity.name} · {activity.targetMinutes} min / day</li>
            ))}
          </ul>
          <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-text-3">
            {preview.rules?.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
          {preview.state !== "open" && <p className="mt-4 text-sm text-text-2">This invite is {preview.state}.</p>}
          {preview.creator && preview.state === "open" && <p className="mt-4 text-sm text-text-2">This is your invite. Share it from the Duels tab.</p>}
          {preview.state === "open" && !preview.creator && auth.status === "signed-out" && (
            <Link href={next} className="btn btn-primary mt-5 h-12 w-full">Sign in to respond</Link>
          )}
          {preview.state === "open" && !preview.creator && auth.status === "signed-in" && (
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void respond("decline")} className="btn btn-ghost h-12 flex-1">Decline</button>
              <button type="button" disabled={busy} onClick={() => void respond("accept")} className="btn btn-primary h-12 flex-1">{busy ? "Joining…" : "Accept"}</button>
            </div>
          )}
          {auth.status === "loading" && <p className="mt-4 text-xs text-text-3">Checking your account…</p>}
        </section>
      )}
    </main>
  );
}
