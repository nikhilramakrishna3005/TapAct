"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { useMotionPrefs } from "./MotionPrefs";

export function SettingsDisclosure({
  title,
  summary,
  aside,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  title: string;
  summary: string;
  aside?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const { reduced } = useMotionPrefs();
  const reactId = useId();
  const buttonId = `settings-${reactId}-button`;
  const panelId = `settings-${reactId}-panel`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open && panelRef.current?.contains(document.activeElement)) {
      buttonRef.current?.focus();
    }
    setOpen(!open);
  };

  return (
    <section className="panel mt-4 px-4 py-4">
      <h2>
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-[-0.01em] text-text-1">
              {title}
            </span>
            {!open && <span className="mt-0.5 block truncate text-xs text-text-3">{summary}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-text-3">
            {aside}
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            ref={panelRef}
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : DURATION.quick, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="mt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
