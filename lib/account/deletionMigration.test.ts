import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261015190000_tapact_account_deletion.sql"),
  "utf8",
);

const scenarios = readFileSync(
  resolve(process.cwd(), "supabase/tests/account_deletion_scenarios.sql"),
  "utf8",
);

describe("account deletion migration", () => {
  it("stops a creator delete from cascading the shared duel", () => {
    expect(migration).toContain("foreign key (creator_id) references auth.users (id) on delete set null");
    expect(migration).toContain("alter table public.tapact_duels alter column creator_id drop not null");
    expect(migration.match(/references auth\.users \(id\) on delete cascade/g)).toEqual([
      "references auth.users (id) on delete cascade",
    ]);
    expect(migration).toContain("set creator_id = null, updated_at = now()");
    expect(migration).not.toMatch(/set creator_id = (?!null)/);
  });

  it("detaches a member instead of transferring creator rights", () => {
    expect(migration).toContain("foreign key (user_id) references auth.users (id) on delete set null");
    expect(migration).toContain("display_name = 'Former member'");
    expect(migration).toContain("set user_id = null");
    expect(migration).toContain("frozen_score = public.tapact_duel_member_score(m.duel_id, m.user_id)");
    expect(migration).not.toMatch(/creator_id\s*=\s*m\.user_id/);
    expect(migration).toContain("where d.id = any(mine)");
  });

  it("authorizes only the signed-in account and does not delete Auth itself", () => {
    expect(migration).toContain("tapact_prepare_account_deletion(p_confirm text)");
    expect(migration).toContain("uid uuid := auth.uid()");
    expect(migration).toContain("last_sign_in_at");
    expect(migration).toContain("interval '10 minutes'");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("grant execute on function public.tapact_prepare_account_deletion(text) to authenticated");
    expect(migration).toContain("revoke all on function public.tapact_prepare_account_deletion(text) from public, anon");
    expect(migration).not.toContain("delete from auth.users");
    expect(migration).not.toMatch(/tapact_prepare_account_deletion\(\s*p_user/);
  });

  it("keeps the live score function and only reads a snapshot after detachment", () => {
    expect(migration).not.toContain("create or replace function public.tapact_duel_member_score");
    expect(migration).toContain("if friend.frozen_score is not null then");
    expect(migration).toContain("friend_score := public.tapact_duel_member_score(p_duel, friend.user_id)");
  });

  it("scrubs shared notices and removes personal stores", () => {
    expect(migration).toContain("left('Former member' || substr(n.body, char_length(v_name) + 1), 240)");
    expect(migration).toContain("replace(n.dedupe_key, uid::text, 'former')");
    expect(migration).toContain("delete from public.tapact_activities where user_id = uid");
    expect(migration).toContain("delete from public.tapact_notifications where recipient_id = uid");
    expect(migration).toContain("delete from public.tapact_push_subscriptions where user_id = uid");
    expect(migration).toContain("delete from public.tapact_duel_characters where user_id = uid");
    expect(migration).toContain("item - 'trackerActivityId'");
    expect(migration).toContain("(accepted_by) references auth.users (id) on delete set null");
    expect(migration).toContain("(proposer_id) references auth.users (id) on delete set null");
  });
});

describe("account deletion scenarios", () => {
  it("refuses to run unless a local test flag is set", () => {
    expect(scenarios).toContain("tapact.allow_deletion_tests");
    expect(scenarios).toContain("DO NOT RUN AGAINST PRODUCTION");
    expect(scenarios).toContain("creator deletion keeps the opponent duel");
    expect(scenarios).toContain("non-creator deletion");
    expect(scenarios).toContain("unauthorized account");
    expect(scenarios).toContain("repeated prepare");
  });
});
