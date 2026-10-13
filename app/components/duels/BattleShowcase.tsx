"use client";

import type { ShowcaseBattle } from "@/lib/duels/showcase";
import { summarizeShowcase } from "@/lib/duels/showcase";

export function BattleShowcase({ battles }: { battles: ShowcaseBattle[] }) {
  const summary = summarizeShowcase(battles);
  const stats = [
    ["Played", summary.played],
    ["Wins", summary.wins],
    ["Losses", summary.losses],
    ["Draws", summary.draws],
  ] as const;

  return (
    <section className="mt-4" aria-label="Battle showcase">
      <h3 className="eyebrow">Battle showcase</h3>
      <p className="mt-1 text-[0.7rem] leading-relaxed text-text-3">
        A consistency day is one where every target was met. The current streak is that run at the end of your newest finished duel. The longest streak is the best run inside any one finished duel.
      </p>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-ink-1 px-1 py-2 text-center">
            <p className="numeric text-lg font-semibold text-text-1">{value}</p>
            <p className="text-[0.65rem] text-text-3">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <div className="rounded-2xl border border-line px-3 py-2">
          <p className="text-[0.65rem] text-text-3">Current streak</p>
          <p className="numeric text-lg font-semibold text-text-1">{summary.currentStreak}</p>
        </div>
        <div className="rounded-2xl border border-line px-3 py-2">
          <p className="text-[0.65rem] text-text-3">Longest streak</p>
          <p className="numeric text-lg font-semibold text-text-1">{summary.longestStreak}</p>
        </div>
      </div>
      {battles.length === 0 ? (
        <p className="mt-2 text-xs text-text-3">No finished duels yet. Wins, losses, and streaks stay at zero until one ends.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {battles.slice(0, 5).map((battle) => (
            <li key={battle.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-text-1">{battle.title}</span>
                <span className="block truncate text-xs text-text-3">vs {battle.opponent}</span>
              </span>
              <span className="shrink-0 text-xs text-text-2">
                {battle.result === "win" ? "Win" : battle.result === "loss" ? "Loss" : "Draw"}
                {" · "}
                {battle.yourScore}–{battle.theirScore}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
