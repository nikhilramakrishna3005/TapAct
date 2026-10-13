import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013140000_tapact_duels.sql"), "utf8");

const tables = [
  "tapact_duels",
  "tapact_duel_activities",
  "tapact_duel_members",
  "tapact_duel_mappings",
  "tapact_duel_invites",
  "tapact_duel_presence",
];

describe("duel migration authorization", () => {
  it("keeps row level security on every new table and blocks client writes", () => {
    for (const table of tables) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
    expect(sql).not.toMatch(/grant (insert|update|delete|select) on public\.tapact_duel/i);
  });

  it("stores invite tokens only as hashes and scores timer sessions", () => {
    expect(sql).toContain("token_hash");
    expect(sql).not.toMatch(/token text not null/);
    expect(sql).toContain("coalesce(source, 'timer') = 'timer'");
    expect(sql).toContain("deleted_at_ms is null");
    expect(sql).toContain("for update");
  });
});
