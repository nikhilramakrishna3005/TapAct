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

  it("archives duels per member and keeps client table access closed", () => {
    const management = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013220000_tapact_duel_management.sql"), "utf8");
    expect(management).toContain("add column if not exists hidden_at timestamptz");
    expect(management).toContain("create or replace function public.tapact_archive_duel");
    expect(management).toContain("create or replace function public.tapact_restore_duel");
    expect(management).toContain("Only finished or cancelled duels can be removed from your list.");
    expect(management).toContain("where duel_id = p_duel and user_id = uid");
    expect(management).toContain("'archived', m.hidden_at is not null");
    expect(management).toContain("'creator', d.creator_id = uid");
    expect(management).toContain("friend.status = 'active' and friend.share_live");
    expect(management).toContain("trackerActivityId");
    expect(management).toContain("prop.proposer_id");
    expect(management).not.toContain("create or replace function public.tapact_duel_timer_minutes");
    expect(management).not.toContain("create or replace function public.tapact_duel_member_score");
    expect(management).not.toMatch(/grant (insert|update|delete|select) on public\.tapact_duel/i);
    expect(management).toContain("grant execute on function public.tapact_archive_duel(uuid) to authenticated");
    expect(management).toContain("grant execute on function public.tapact_restore_duel(uuid) to authenticated");
  });

  it("does not look up the deferred sort constraint from an empty search_path", () => {
    const management = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013220000_tapact_duel_management.sql"), "utf8");
    expect(management).toContain("create or replace function public.tapact_set_duel_rules(p_duel uuid, payload jsonb)");
    expect(management).toContain("create or replace function public.tapact_approve_duel_proposal(p_proposal uuid)");
    expect(management).not.toContain("create or replace function public.tapact_duel_install_rules");
    expect(management).not.toContain("create or replace function public.tapact_duel_timer_minutes");
    expect(management).not.toContain("create or replace function public.tapact_duel_member_score");
    const bodies = management.split(/create or replace function/i).slice(1);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(body.toLowerCase()).not.toMatch(/set\s+constraints/);
    }
    const setRules = bodies.find((body) => body.includes("tapact_set_duel_rules(p_duel uuid, payload jsonb)"));
    expect(setRules).toBeDefined();
    expect(setRules).toContain("d.creator_id is distinct from uid or d.status <> 'pending'");
    expect(setRules).toContain("set name = v_activity_name, target_minutes = v_target_minutes, sort_order = v_sort_order");
    expect(setRules).not.toMatch(/set name = name\b/);
    expect(setRules).not.toContain("tapact_duel_activities_sort_unique");
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

  it("stores invite tokens only as hashes and scores timer sessions", () => {
    expect(sql).toContain("token_hash");
    expect(sql).not.toMatch(/token text not null/);
    expect(sql).toContain("coalesce(source, 'timer') = 'timer'");
    expect(sql).toContain("deleted_at_ms is null");
    expect(sql).toContain("for update");
  });
});
