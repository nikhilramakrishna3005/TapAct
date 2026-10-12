import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/redirect";
import { AuthScreen, type AuthMode } from "../components/auth/AuthScreen";
import { MotionPrefsProvider } from "../components/MotionPrefs";

export const metadata: Metadata = {
  title: "Account — TapAct",
  robots: { index: false },
};

const ENTRY_MODES: AuthMode[] = ["sign-in", "sign-up", "forgot", "reset"];

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawMode = first(params.mode);
  const mode = ENTRY_MODES.find((candidate) => candidate === rawMode) ?? "sign-in";
  const next = safeNextPath(first(params.next));
  const nextPath = next.startsWith("/auth") ? "/" : next;
  const error = first(params.error);

  return (
    <MotionPrefsProvider>
      <AuthScreen initialMode={mode} next={nextPath} callbackError={error ? error.slice(0, 40) : null} />
    </MotionPrefsProvider>
  );
}
