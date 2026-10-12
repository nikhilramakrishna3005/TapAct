"use client";

import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, CloudOff, LogIn, LogOut, MailWarning, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getInitials } from "@/lib/auth/account";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { useAuth } from "./AuthProvider";
import { SectionCard } from "./ui";

const RETURN_TO_SETTINGS = encodeURIComponent("/?tab=settings");

function CloudSyncStatus() {
  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-text-1">
          <CloudOff className="size-3.5 text-text-3" aria-hidden="true" />
          Cloud sync
        </p>
        <span className="rounded-full border border-line-strong px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-3">
          Not available yet
        </span>
      </div>
      <p className="mt-2 text-[0.72rem] leading-relaxed text-text-3">
        Account sign-in works, but activities aren&apos;t backed up to your account yet. Your history stays on
        this device. Use Export below to keep a copy.
      </p>
    </div>
  );
}

export function AccountSection() {
  const { status, account, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SectionCard title="Account" aside={<UserRound className="size-4 text-text-3" />}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: DURATION.quick, ease: EASE_OUT }}
        >
          {status === "loading" && (
            <div className="flex items-center gap-3" role="status" aria-label="Checking account">
              <span className="size-11 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="flex-1 space-y-2">
                <span className="block h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
                <span className="block h-3 w-3/4 animate-pulse rounded bg-white/[0.04]" />
              </div>
            </div>
          )}

          {status === "unavailable" && (
            <p className="text-xs leading-relaxed text-text-2">
              Accounts aren&apos;t available in this version of TapAct. Everything works as a guest, and your
              activity stays on this device.
            </p>
          )}

          {status === "signed-out" && (
            <>
              <p className="text-xs leading-relaxed text-text-2">
                You&apos;re using TapAct as a guest. Signing in is optional, and your activity on this device stays
                exactly where it is.
              </p>
              <div className="mt-3 flex gap-2">
                <Link href={`/auth?mode=sign-in&next=${RETURN_TO_SETTINGS}`} className="btn btn-ghost h-12 flex-1">
                  <LogIn className="size-4" />
                  Sign in
                </Link>
                <Link href={`/auth?mode=sign-up&next=${RETURN_TO_SETTINGS}`} className="btn btn-electric h-12 flex-1">
                  <UserPlus className="size-4" />
                  Create account
                </Link>
              </div>
              <CloudSyncStatus />
            </>
          )}

          {status === "signed-in" && account && (
            <>
              <div className="flex items-center gap-3">
                <span className="relative grid size-12 shrink-0 place-items-center">
                  <svg viewBox="0 0 48 48" className="absolute inset-0" aria-hidden="true">
                    <defs>
                      <linearGradient id="account-ring" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#8E7BFF" />
                        <stop offset="1" stopColor="#5FE3FF" />
                      </linearGradient>
                    </defs>
                    <circle cx="24" cy="24" r="22" fill="none" stroke="url(#account-ring)" strokeWidth="1.5" />
                    <circle cx="24" cy="2" r="2.5" fill="var(--ice)" />
                  </svg>
                  <span className="text-sm font-bold text-text-1">{getInitials(account)}</span>
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-1">{account.displayName ?? "TapAct member"}</p>
                  <p className="truncate text-xs text-text-2">{account.email}</p>
                  {account.emailVerified ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[0.68rem] font-medium text-mint">
                      <BadgeCheck className="size-3.5" aria-hidden="true" />
                      Email verified
                    </p>
                  ) : (
                    <p className="mt-1 inline-flex items-center gap-1 text-[0.68rem] font-medium text-ember">
                      <MailWarning className="size-3.5" aria-hidden="true" />
                      Email not verified
                    </p>
                  )}
                </div>
              </div>
              <CloudSyncStatus />
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-busy={signingOut}
                className="btn btn-ghost mt-3 h-12 w-full"
              >
                <LogOut className="size-4" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
              <p className="mt-2 text-center text-[0.68rem] text-text-3">
                Signing out keeps all activity on this device.
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </SectionCard>
  );
}
