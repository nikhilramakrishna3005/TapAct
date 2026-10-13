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

  it("lets only the pending creator change shared activities", () => {
    const rules = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013150000_tapact_duel_rules.sql"), "utf8");
    expect(rules).toContain("d.status <> 'pending'");
    expect(rules).toContain("d.creator_id is distinct from uid");
    expect(rules).toContain("for update");
    expect(rules).toContain("set name = v_activity_name, target_minutes = v_target_minutes, sort_order = v_sort_order");
    expect(rules).toContain("values (p_duel, v_activity_name, v_target_minutes, v_sort_order)");
    expect(rules).not.toMatch(/set name = name\b/);
    expect(rules).toContain("array['duel_id', 'sort_order']");
    expect(rules).toContain("into strict cname");
    expect(rules).not.toMatch(/for cname in/);
    expect(rules).not.toContain("tapact_duel_member_score");
    expect(rules).not.toContain("tapact_duel_timer_minutes");
    expect(rules).not.toMatch(/grant (insert|update|delete|select) on public\.tapact_duel/i);
    expect(rules).toContain("grant execute on function public.tapact_set_duel_rules(uuid, jsonb) to authenticated");
  });

  it("stores invite tokens only as hashes and scores timer sessions", () => {
    expect(sql).toContain("token_hash");
    expect(sql).not.toMatch(/token text not null/);
    expect(sql).toContain("coalesce(source, 'timer') = 'timer'");
    expect(sql).toContain("deleted_at_ms is null");
    expect(sql).toContain("for update");
  });
});
