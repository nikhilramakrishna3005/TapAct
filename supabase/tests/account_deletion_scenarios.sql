-- DO NOT RUN AGAINST PRODUCTION.
-- Isolated Supabase test database only. This file is not a migration.
-- It does nothing unless the session has explicitly opted in:
--
--   select set_config('tapact.allow_deletion_tests', 'yes', false);
--   \i supabase/tests/account_deletion_scenarios.sql
--
-- The script inserts fixture Auth users, calls tapact_prepare_account_deletion,
-- then deletes those Auth rows locally to simulate the later admin delete.
-- It does not call the Supabase Auth admin API and does not use a service-role key.
-- Personal data deleted here cannot be restored. Do not point it at a shared project.
--
-- Unexecuted in CI. Reviewers run it on `supabase start` or another empty database
-- after the migrations, including 20261015190000_tapact_account_deletion.sql.

do $guard$
begin
  if current_setting('tapact.allow_deletion_tests', true) is distinct from 'yes' then
    raise exception 'Refusing account-deletion scenarios. Set tapact.allow_deletion_tests=yes on an empty local database only.';
  end if;
end
$guard$;

-- Fixture identities. .invalid is not a real mailbox.
-- Kept as a comment so opening or accidentally running this file cannot write.
-- Paste it inside a local transaction only after the guard above has passed.
/*
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'ada@deletion-test.invalid', '',
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Ada"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'bo@deletion-test.invalid', '',
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Bo"}'::jsonb,
    now(), now(), '', '', '', ''
  )
on conflict (id) do update
set last_sign_in_at = now(), email = excluded.email;
*/

-- creator deletion keeps the opponent duel
-- Seed one active duel created by Ada, accepted by Bo, with Bo's own activity and a timer row.
-- Then sign in as Ada and prepare deletion.
-- Expect: duel row remains, creator_id is null, Ada's member name is Former member,
-- Ada's user_id is null, Ada's frozen_score is not null, Bo's activity and time entry remain,
-- Bo's membership user_id is unchanged, Ada's presence and mappings are gone.

-- non-creator deletion
-- Sign in as Bo on a second duel created by Ada.
-- Expect: creator_id stays Ada, Bo's member row is anonymized, Ada's score still calculates live.

-- completed duel
-- Status completed before deletion. Expect the duel and Bo's membership to remain,
-- and the detached member's frozen_score to equal the pre-delete tapact_duel_member_score output.

-- active duel
-- Status stays active for the survivor. Detached member status becomes left.
-- Survivor time entries are untouched.

-- pending invitation
-- Ada created a pending duel and an unaccepted invite, with no second member.
-- Expect that duel to be deleted, and the invite with it. A second pending invite
-- on a duel Bo already joined is revoked and the duel remains.

-- other member score
-- Insert a timer entry only for Bo. After Ada is prepared, Bo's tapact_duel_member_score
-- is unchanged. Ada's personal tapact_time_entries are gone. The board's friend.score
-- for Bo, when Ada is the viewer, is irrelevant because Ada can no longer sign in.
-- When Bo opens the board, friend.name is Former member and friend.score equals the snapshot.

-- multiple duels
-- Ada is creator of one duel and the non-creator of another. Both opponent rows remain.
-- A third duel with only Ada is removed.

-- repeated prepare
-- Call tapact_prepare_account_deletion a second time as Ada. Expect status prepared and
-- no extra member rows. Bo's activity count stays the same.

-- failed confirmation rolls back
-- Call as Ada with the wrong email inside a subtransaction that rolls back? The function
-- raises before writes when the email does not match. Wrap a wrong confirm in
-- begin/exception and assert creator_id is still set before any successful prepare.
-- A raised error inside the function aborts its transaction, so a failed call leaves
-- no anonymized row. There is no commit inside the function.

-- unauthorized account
-- Sign in as Bo and call tapact_prepare_account_deletion with Ada's email.
-- Expect an exception. Ada's membership user_id is unchanged by that call.

-- notification and push cleanup
-- Insert an opponent_left notice for Bo whose body starts with Ada's display name and
-- whose dedupe_key ends in Ada's user id. Insert a push subscription for Ada.
-- After prepare: Bo's notice body starts with Former member, the dedupe_key no longer
-- contains Ada's user id, Ada's subscription is gone, and Bo's subscription remains.
-- A notice already accepted by a push service is not in the database and is not cleared.

-- no orphaned foreign keys
-- delete from auth.users where id = Ada, simulating the later admin delete.
-- Expect no error. creator_id and member user_id for Ada are already null.
-- Bo's user_id foreign keys still resolve. The deletion-request row is gone.

-- deleted name and tracker are not readable
-- As Bo, tapact_duel_board does not return Ada's email, Ada's tracker activity id,
-- or Ada's pre-deletion display name. tapact_activities for Ada has zero rows.

-- surviving history
-- Bo's tapact_activities, tapact_time_entries, and live tapact_duel_member_score remain.
-- The shared duel id, title, and rule items remain.

-- The statements above are the contract for a local run. They are comments so this
-- file cannot modify data merely by being read. A reviewer pastes each scenario
-- into a transaction on the empty database, then rolls that transaction back.
