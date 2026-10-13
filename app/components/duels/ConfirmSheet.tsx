"use client";

import { Sheet } from "../ui";

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet label={title} layer="nested" onClose={busy ? () => undefined : onClose}>
      <p className="mt-4 text-sm leading-relaxed text-text-2">{body}</p>
      <div className="mt-5 flex gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="btn btn-ghost h-12 flex-1">
          Keep
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`btn h-12 flex-1 ${danger ? "btn-ghost text-danger" : "btn-primary"}`}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
