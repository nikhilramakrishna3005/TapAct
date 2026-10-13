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

  it("versions duel rules and keeps client table access closed", () => {
    const rules = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013160000_tapact_duel_rule_versions.sql"), "utf8");
    for (const table of ["tapact_duel_rule_versions", "tapact_duel_rule_items", "tapact_duel_proposals"]) {
      expect(rules).toContain(`alter table public.${table} enable row level security`);
      expect(rules).toContain(`alter table public.${table} force row level security`);
      expect(rules).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
    expect(rules).toContain("confrelid = 'public.tapact_duel_activities'::regclass");
    expect(rules).toContain("The other player has to approve this change.");
    expect(rules).toContain("d.status <> 'active'");
    expect(rules).not.toContain("create or replace function public.tapact_duel_timer_minutes");
    expect(rules).not.toMatch(/grant (insert|update|delete|select) on public\.tapact_duel/i);
  });

  it("stops empty-search-path rule edits from looking up the deferred sort constraint", () => {
    const repair = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013170000_tapact_duel_sort_constraint_lookup.sql"), "utf8");
    const pending = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013150000_tapact_duel_rules.sql"), "utf8");
    const versions = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013160000_tapact_duel_rule_versions.sql"), "utf8");
    expect(pending).toContain("unique (duel_id, sort_order) deferrable initially deferred");
    expect(pending).toContain("set constraints tapact_duel_activities_sort_unique deferred");
    expect(versions).toContain("set constraints tapact_duel_activities_sort_unique deferred");
    expect(repair).toContain("create or replace function public.tapact_set_duel_rules(p_duel uuid, payload jsonb)");
    expect(repair).toContain("create or replace function public.tapact_duel_install_rules(p_duel uuid, payload jsonb, p_effective date)");
    const bodies = repair.split(/create or replace function/i).slice(1);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(body.toLowerCase()).not.toContain("set constraints");
    }
    expect(repair).toContain("d.creator_id is distinct from uid or d.status <> 'pending'");
    expect(repair).toContain("set name = v_activity_name, target_minutes = v_target_minutes, sort_order = v_sort_order");
    expect(repair).toContain("set name = v_activity_name, target_minutes = v_target_minutes, sort_order = idx");
    expect(repair).not.toMatch(/alter table|drop constraint|row level security|grant |revoke /i);
  });

  it("stores invite tokens only as hashes and scores timer sessions", () => {
    expect(sql).toContain("token_hash");
    expect(sql).not.toMatch(/token text not null/);
    expect(sql).toContain("coalesce(source, 'timer') = 'timer'");
    expect(sql).toContain("deleted_at_ms is null");
    expect(sql).toContain("for update");
  });
});
