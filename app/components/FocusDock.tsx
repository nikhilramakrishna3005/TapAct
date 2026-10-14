"use client";

import { motion } from "motion/react";
import { CalendarDays, House, LineChart, Settings2, Swords, type LucideIcon } from "lucide-react";
import { SPRING_SNAPPY } from "@/lib/motion";
import { useMotionPrefs } from "./MotionPrefs";

export type AppTab = "home" | "insights" | "duels" | "history" | "settings";

export const NAV_ITEMS: { id: AppTab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Today", icon: House },
  { id: "insights", label: "Insights", icon: LineChart },
  { id: "duels", label: "Duels", icon: Swords },
  { id: "history", label: "History", icon: CalendarDays },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function FocusDock({
  tab,
  onChange,
}: {
  tab: AppTab;
  onChange: (tab: AppTab) => void;
}) {
  const { reduced } = useMotionPrefs();

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(0.7rem+env(safe-area-inset-bottom))] z-20"
    >
      <div className="pointer-events-auto mx-auto flex w-[calc(100%-1.5rem)] max-w-[400px] items-stretch rounded-full border border-[var(--dock-line)] bg-[var(--dock)] px-1.5 py-1 shadow-[0_18px_36px_-22px_var(--shadow)]">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const current = tab === item.id;
          const featured = item.id === "duels";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={current ? "page" : undefined}
              className="relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-full px-0.5 pb-1.5 pt-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt-hi"
            >
              {current && (
                <motion.span
                  layoutId="focus-light"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-[10%] top-0 h-full"
                  transition={reduced ? { duration: 0 } : SPRING_SNAPPY}
                >
                  <span
                    className="absolute left-1/2 top-[4px] h-[2px] w-[22px] -translate-x-1/2 rounded-full"
                    style={{
                      background: "linear-gradient(90deg, #8e7bff, #5fe3ff)",
                      boxShadow: "0 0 8px rgba(142,123,255,0.7), 0 0 14px rgba(95,227,255,0.35)",
                    }}
                  />
                  <span
                    className="absolute left-1/2 top-[5px] h-9 w-11 -translate-x-1/2"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(142,123,255,0.38) 0%, rgba(95,227,255,0.12) 48%, transparent 100%)",
                      clipPath: "polygon(30% 0, 70% 0, 100% 100%, 0 100%)",
                    }}
                  />
                </motion.span>
              )}
              <Icon
                className={`relative size-[18px] transition-colors ${
                  current ? "text-text-1" : featured ? "text-text-2" : "text-text-3"
                }`}
                strokeWidth={featured ? 2.15 : 2}
              />
              <span
                className={`relative mt-0.5 text-[0.62rem] font-medium tracking-[0.01em] transition-colors ${
                  current ? "text-text-1" : featured ? "text-text-2" : "text-text-3"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
