"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info } from "lucide-react";
import { forwardRef, useId, useState } from "react";
import { DURATION, EASE_OUT } from "@/lib/motion";
import type { PasswordStrength } from "@/lib/auth/validation";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: React.ReactNode;
  type?: "text" | "email";
  autoComplete: string;
  inputMode?: "email" | "text";
  disabled?: boolean;
  maxLength?: number;
};

function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: React.ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {error ? (
        <motion.p
          key="error"
          id={id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.quick, ease: EASE_OUT }}
          className="mt-1.5 flex items-start gap-1.5 text-[0.75rem] leading-snug text-danger"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </motion.p>
      ) : hint ? (
        <motion.div key="hint" id={id} className="mt-1.5 text-[0.72rem] leading-snug text-text-3">
          {hint}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export const AuthField = forwardRef<HTMLInputElement, FieldProps>(function AuthField(
  { label, value, onChange, error, hint, type = "text", autoComplete, inputMode, disabled, maxLength },
  ref,
) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.78rem] font-medium text-text-2">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={type === "email" ? "none" : "words"}
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={`field auth-field ${error ? "is-invalid" : ""}`}
      />
      <FieldMessage id={messageId} error={error} hint={hint} />
    </div>
  );
});

export const PasswordField = forwardRef<
  HTMLInputElement,
  Omit<FieldProps, "type" | "inputMode"> & { strength?: PasswordStrength | null }
>(function PasswordField({ label, value, onChange, error, hint, autoComplete, disabled, strength }, ref) {
  const id = useId();
  const messageId = `${id}-message`;
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.78rem] font-medium text-text-2">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={`field auth-field !pr-12 ${error ? "is-invalid" : ""}`}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-[var(--radius-sm)] text-text-3 transition-colors hover:text-text-1"
        >
          {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      </div>
      {strength && strength.score > 0 && (
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className="h-1 flex-1 rounded-full transition-colors"
                style={{
                  background:
                    step <= strength.score
                      ? strength.score >= 3
                        ? "var(--mint)"
                        : strength.score === 2
                          ? "var(--ice)"
                          : "var(--ember)"
                      : "rgba(255,255,255,0.08)",
                }}
              />
            ))}
          </div>
          <span className="w-12 text-right text-[0.68rem] font-medium text-text-3">{strength.label}</span>
        </div>
      )}
      <FieldMessage id={messageId} error={error} hint={hint} />
    </div>
  );
});

export function SubmitButton({
  busy,
  disabled,
  children,
  busyLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy}
      className="btn btn-electric h-[52px] w-full text-[0.95rem]"
    >
      {busy ? (
        <>
          <span className="busy-orbit" aria-hidden="true" />
          <span>{busyLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Notice({ tone, children }: { tone: "error" | "info" | "success"; children: React.ReactNode }) {
  const Icon = tone === "error" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  const styles =
    tone === "error"
      ? "border-danger/30 bg-danger/[0.07] text-[#FFD0D0]"
      : tone === "success"
        ? "border-mint/30 bg-mint/[0.07] text-[#C9FBE7]"
        : "border-ice/25 bg-ice/[0.06] text-[#CFF6FF]";
  return (
    <motion.div
      role={tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: DURATION.quick, ease: EASE_OUT }}
      className={`flex items-start gap-2 rounded-2xl border px-3 py-2.5 text-[0.78rem] leading-relaxed ${styles}`}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </motion.div>
  );
}
