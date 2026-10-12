"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, CloudOff, MailCheck, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { classifyAuthError, describeAuthError, describeCallbackError } from "@/lib/auth/errors";
import { buildConfirmUrl, RESET_PASSWORD_PATH } from "@/lib/auth/redirect";
import {
  getPasswordStrength,
  NAME_MAX_LENGTH,
  normalizeEmail,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validateSignInPassword,
} from "@/lib/auth/validation";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/supabase/config";
import { OrbitMark } from "../Orbit";
import { Segmented } from "../ui";
import { AuthOrbit, type OrbitPose } from "./AuthOrbit";
import { AuthField, Notice, PasswordField, SubmitButton } from "./fields";

export type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset" | "check-email" | "reset-sent" | "reset-done";

const RESEND_COOLDOWN_S = 60;

const COPY: Record<AuthMode, { eyebrow: string; title: string; body?: string }> = {
  "sign-in": {
    eyebrow: "Welcome back",
    title: "Sign in to TapAct",
  },
  "sign-up": {
    eyebrow: "New here",
    title: "Create your account",
  },
  forgot: {
    eyebrow: "Account recovery",
    title: "Reset your password",
    body: "Enter the email you signed up with and we'll send a secure reset link.",
  },
  reset: {
    eyebrow: "Account recovery",
    title: "Set a new password",
    body: "Choose a new password for your TapAct account.",
  },
  "check-email": {
    eyebrow: "Almost there",
    title: "Check your inbox",
  },
  "reset-sent": {
    eyebrow: "Link sent",
    title: "Check your inbox",
  },
  "reset-done": {
    eyebrow: "All set",
    title: "Password updated",
    body: "You're signed in with your new password.",
  },
};

function poseFor(mode: AuthMode): OrbitPose {
  switch (mode) {
    case "check-email":
    case "reset-sent":
      return "sent";
    case "reset-done":
      return "done";
    default:
      return mode;
  }
}

type Errors = Partial<Record<"name" | "email" | "password" | "confirm", string | null>>;

export function AuthScreen({
  initialMode,
  next,
  callbackError,
}: {
  initialMode: AuthMode;
  next: string;
  callbackError: string | null;
}) {
  const router = useRouter();
  const [mode, setModeState] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(describeCallbackError(callbackError));
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [recovery, setRecovery] = useState<"checking" | "ready" | "missing">("checking");

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfigured(getSupabaseBrowserClient() !== null);
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const id = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (mode !== "reset") {
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setRecovery("missing");
      return;
    }
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => !cancelled && setRecovery(data.session ? "ready" : "missing"))
      .catch(() => !cancelled && setRecovery("missing"));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancelled && session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        setRecovery("ready");
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [mode]);

  const setMode = useCallback((nextMode: AuthMode, options: { keepError?: boolean } = {}) => {
    setModeState(nextMode);
    setErrors({});
    setUnconfirmed(false);
    setResendNote(null);
    if (!options.keepError) {
      setFormError(null);
    }
    if (nextMode !== "check-email" && nextMode !== "reset-sent" && nextMode !== "reset-done") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", nextMode);
      url.searchParams.delete("error");
      window.history.replaceState(window.history.state, "", url);
    }
    window.scrollTo({ top: 0 });
  }, []);

  const confirmUrl = useCallback((path: string) => buildConfirmUrl(getSiteUrl(), path), []);

  const focusFirstInvalid = (found: Errors) => {
    const order: [keyof Errors, React.RefObject<HTMLInputElement | null>][] = [
      ["name", nameRef],
      ["email", emailRef],
      ["password", passwordRef],
      ["confirm", confirmRef],
    ];
    order.find(([key]) => found[key])?.[1].current?.focus();
  };

  const run = async (task: () => Promise<void>) => {
    setFormError(null);
    setResendNote(null);
    if (!navigator.onLine) {
      setFormError("You're offline. Connect to the internet to use your account. Tracking keeps working as a guest.");
      return;
    }
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const validate = (found: Errors) => {
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      focusFirstInvalid(found);
      return false;
    }
    return true;
  };

  const handleSignIn = (event: FormEvent) => {
    event.preventDefault();
    setUnconfirmed(false);
    if (!validate({ email: validateEmail(email), password: validateSignInPassword(password) })) {
      return;
    }
    void run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) {
        setUnconfirmed(classifyAuthError(error) === "email-not-confirmed");
        setFormError(describeAuthError(error));
        return;
      }
      setPassword("");
      router.replace(next);
    });
  };

  const handleSignUp = (event: FormEvent) => {
    event.preventDefault();
    if (
      !validate({
        name: validateName(name),
        email: validateEmail(email),
        password: validateNewPassword(password),
        confirm: validatePasswordConfirmation(password, confirm),
      })
    ) {
      return;
    }
    void run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const address = normalizeEmail(email);
      const { data, error } = await supabase.auth.signUp({
        email: address,
        password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: confirmUrl(next) },
      });
      if (error) {
        setFormError(describeAuthError(error));
        return;
      }
      setPassword("");
      setConfirm("");
      if (data.session) {
        router.replace(next);
        return;
      }
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_S);
      setMode("check-email");
    });
  };

  const handleForgot = (event: FormEvent) => {
    event.preventDefault();
    if (!validate({ email: validateEmail(email) })) {
      return;
    }
    void run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const address = normalizeEmail(email);
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: confirmUrl(RESET_PASSWORD_PATH),
      });
      if (error && classifyAuthError(error) !== "other") {
        setFormError(describeAuthError(error));
        return;
      }
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_S);
      setMode("reset-sent");
    });
  };

  const handleReset = (event: FormEvent) => {
    event.preventDefault();
    if (
      !validate({
        password: validateNewPassword(password),
        confirm: validatePasswordConfirmation(password, confirm),
      })
    ) {
      return;
    }
    void run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(describeAuthError(error));
        return;
      }
      setPassword("");
      setConfirm("");
      setMode("reset-done");
    });
  };

  const resendVerification = (address: string) => {
    if (validateEmail(address)) {
      setErrors({ email: validateEmail(address) });
      emailRef.current?.focus();
      return;
    }
    void run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const normalized = normalizeEmail(address);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalized,
        options: { emailRedirectTo: confirmUrl(next) },
      });
      if (error) {
        setFormError(describeAuthError(error));
        return;
      }
      setSentTo(normalized);
      setCooldown(RESEND_COOLDOWN_S);
      if (mode !== "check-email") {
        setMode("check-email");
      } else {
        setResendNote("A fresh verification link is on its way.");
      }
    });
  };

  const resendReset = () => {
    void run(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { error } = await supabase.auth.resetPasswordForEmail(sentTo, {
        redirectTo: confirmUrl(RESET_PASSWORD_PATH),
      });
      if (error && classifyAuthError(error) !== "other") {
        setFormError(describeAuthError(error));
        return;
      }
      setCooldown(RESEND_COOLDOWN_S);
      setResendNote("Another reset link is on its way.");
    });
  };

  const copy = COPY[mode];
  const disabled = !configured;
  const isEntry = mode === "sign-in" || mode === "sign-up";

  return (
    <div className="auth-backdrop relative min-h-[100dvh] overflow-x-hidden text-text-1">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <header className="flex h-12 items-center justify-between">
          <Link
            href={next}
            className="-ml-2 grid size-11 place-items-center rounded-full text-text-2 transition-colors hover:text-text-1"
            aria-label="Back to TapAct"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex items-center gap-2">
            <OrbitMark size={22} />
            <span className="text-[0.95rem] font-semibold tracking-[-0.03em]">TapAct</span>
          </div>
          <span className="size-11" aria-hidden="true" />
        </header>

        <motion.div
          className="mt-4"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: DURATION.slow * 2, ease: EASE_OUT }}
        >
          <AuthOrbit pose={poseFor(mode)} busy={busy} />
        </motion.div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="flex flex-1 flex-col"
          >
            <div className="mt-5 text-center">
              <p className="eyebrow">{copy.eyebrow}</p>
              <h1 className="display mt-2.5 text-[2rem]">{copy.title}</h1>
              {copy.body && <p className="mx-auto mt-2.5 max-w-[320px] text-sm leading-relaxed text-text-2">{copy.body}</p>}
              {(mode === "check-email" || mode === "reset-sent") && (
                <p className="mx-auto mt-2.5 max-w-[330px] text-sm leading-relaxed text-text-2">
                  {mode === "check-email" ? "We sent a verification link to " : "If an account exists for "}
                  <span className="font-semibold text-text-1 [overflow-wrap:anywhere]">{sentTo}</span>
                  {mode === "check-email"
                    ? ". Open it to confirm your email and finish creating your account."
                    : ", a password reset link is on its way."}
                </p>
              )}
            </div>

            <div className="mt-6 space-y-3" aria-live="polite">
              {!configured && (
                <Notice tone="info">
                  Accounts aren&apos;t available in this version of TapAct. Everything works as a guest, and your
                  activity stays on this device.
                </Notice>
              )}
              {configured && !online && (
                <Notice tone="info">
                  <span className="inline-flex items-center gap-1.5">
                    <WifiOff className="size-3.5" aria-hidden="true" /> You&apos;re offline.
                  </span>{" "}
                  Signing in needs a connection, but tracking keeps working as a guest.
                </Notice>
              )}
              <AnimatePresence>
                {formError && (
                  <Notice key={formError} tone="error">
                    {formError}
                    {unconfirmed && (
                      <button
                        type="button"
                        onClick={() => resendVerification(email)}
                        disabled={busy}
                        className="mt-1.5 block font-semibold text-text-1 underline decoration-volt underline-offset-4"
                      >
                        Resend verification email
                      </button>
                    )}
                  </Notice>
                )}
                {resendNote && (
                  <Notice key="resend" tone="success">
                    {resendNote}
                  </Notice>
                )}
              </AnimatePresence>
            </div>

            <div className="auth-card mt-3 px-4 pb-5 pt-4">
              {isEntry && (
                <div className="mb-5">
                  <Segmented
                    label="Account action"
                    layoutId="auth-mode"
                    size="md"
                    value={mode}
                    onChange={(value) => setMode(value)}
                    options={[
                      { value: "sign-in", label: "Sign in" },
                      { value: "sign-up", label: "Create account" },
                    ]}
                  />
                </div>
              )}

              {mode === "sign-in" && (
                <form noValidate onSubmit={handleSignIn} className="space-y-4">
                  <AuthField
                    ref={emailRef}
                    label="Email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={setEmail}
                    error={errors.email}
                    disabled={disabled}
                  />
                  <PasswordField
                    ref={passwordRef}
                    label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={setPassword}
                    error={errors.password}
                    disabled={disabled}
                  />
                  <div className="-mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="min-h-9 text-[0.78rem] font-medium text-volt-hi transition-colors hover:text-text-1"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <SubmitButton busy={busy} disabled={disabled} busyLabel="Signing in…">
                    Sign in
                    <ArrowRight className="size-4" />
                  </SubmitButton>
                </form>
              )}

              {mode === "sign-up" && (
                <form noValidate onSubmit={handleSignUp} className="space-y-4">
                  <AuthField
                    ref={nameRef}
                    label="Name"
                    autoComplete="name"
                    value={name}
                    onChange={setName}
                    error={errors.name}
                    maxLength={NAME_MAX_LENGTH}
                    disabled={disabled}
                  />
                  <AuthField
                    ref={emailRef}
                    label="Email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={setEmail}
                    error={errors.email}
                    disabled={disabled}
                  />
                  <PasswordField
                    ref={passwordRef}
                    label="Password"
                    autoComplete="new-password"
                    value={password}
                    onChange={setPassword}
                    error={errors.password}
                    hint="At least 8 characters, with a letter and a number."
                    strength={getPasswordStrength(password)}
                    disabled={disabled}
                  />
                  <PasswordField
                    ref={confirmRef}
                    label="Confirm password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={setConfirm}
                    error={errors.confirm}
                    disabled={disabled}
                  />
                  <SubmitButton busy={busy} disabled={disabled} busyLabel="Creating account…">
                    Create account
                    <ArrowRight className="size-4" />
                  </SubmitButton>
                  <p className="flex items-start gap-2 text-[0.72rem] leading-relaxed text-text-3">
                    <CloudOff className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    Creating an account doesn&apos;t back up your activities yet. Your history stays on this device
                    until cloud sync arrives.
                  </p>
                </form>
              )}

              {mode === "forgot" && (
                <form noValidate onSubmit={handleForgot} className="space-y-4">
                  <AuthField
                    ref={emailRef}
                    label="Email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={setEmail}
                    error={errors.email}
                    disabled={disabled}
                  />
                  <SubmitButton busy={busy} disabled={disabled} busyLabel="Sending link…">
                    Send reset link
                  </SubmitButton>
                  <button type="button" onClick={() => setMode("sign-in")} className="btn btn-ghost h-12 w-full">
                    Back to sign in
                  </button>
                </form>
              )}

              {mode === "reset" &&
                (recovery === "checking" ? (
                  <p className="py-6 text-center text-sm text-text-3" role="status">
                    Verifying your reset link…
                  </p>
                ) : recovery === "missing" ? (
                  <div className="space-y-4">
                    <p className="text-sm leading-relaxed text-text-2">
                      This reset link has expired or was opened in a different browser. Request a new link to
                      continue.
                    </p>
                    <button type="button" onClick={() => setMode("forgot")} className="btn btn-electric h-[52px] w-full">
                      Request a new link
                    </button>
                  </div>
                ) : (
                  <form noValidate onSubmit={handleReset} className="space-y-4">
                    <PasswordField
                      ref={passwordRef}
                      label="New password"
                      autoComplete="new-password"
                      value={password}
                      onChange={setPassword}
                      error={errors.password}
                      hint="At least 8 characters, with a letter and a number."
                      strength={getPasswordStrength(password)}
                    />
                    <PasswordField
                      ref={confirmRef}
                      label="Confirm new password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={setConfirm}
                      error={errors.confirm}
                    />
                    <SubmitButton busy={busy} busyLabel="Updating password…">
                      Update password
                    </SubmitButton>
                  </form>
                ))}

              {(mode === "check-email" || mode === "reset-sent") && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-line bg-ink-0 px-3 py-3">
                    <MailCheck className="mt-0.5 size-4 shrink-0 text-ice" aria-hidden="true" />
                    <p className="text-[0.78rem] leading-relaxed text-text-2">
                      For the smoothest experience, open the link on this device. It can take a minute to arrive,
                      so check spam or promotions too.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || cooldown > 0}
                    onClick={() => (mode === "check-email" ? resendVerification(sentTo) : resendReset())}
                    className="btn btn-ghost h-12 w-full"
                  >
                    {busy ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
                  </button>
                  <button type="button" onClick={() => setMode("sign-in")} className="btn btn-ghost h-12 w-full">
                    Back to sign in
                  </button>
                </div>
              )}

              {mode === "reset-done" && (
                <button type="button" onClick={() => router.replace(next)} className="btn btn-electric h-[52px] w-full">
                  Continue to TapAct
                  <ArrowRight className="size-4" />
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {mode !== "reset-done" && mode !== "reset" && (
          <div className="mt-6 text-center">
            <div className="flex items-center gap-3 text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-text-3">
              <span className="h-px flex-1 bg-line-strong" />
              or
              <span className="h-px flex-1 bg-line-strong" />
            </div>
            <Link href={next} className="btn btn-ghost mt-4 h-12 w-full">
              Continue as guest
            </Link>
            <p className="mx-auto mt-3 max-w-[300px] text-[0.72rem] leading-relaxed text-text-3">
              Guest mode keeps every activity on this device. You can sign in any time from Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
