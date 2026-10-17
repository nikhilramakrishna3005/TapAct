-- DO NOT RUN AGAINST PRODUCTION.
-- Disposable local Postgres only. The caller must set tapact.allow_deletion_tests=yes.
-- Scenarios: creator deletion keeps the opponent duel, non-creator deletion,
-- active duel, completed duel, pending invitation, multiple duels, frozen historical
-- scores, remaining member arena and recap, repeated prepare, incorrect email,
-- unauthorized account, surviving notification data, deletion with no surviving member.

do $$
begin
  if current_setting('tapact.allow_deletion_tests', true) is distinct from 'yes' then
    raise exception 'Refusing account deletion scenarios. Set tapact.allow_deletion_tests=yes on a disposable database. DO NOT RUN AGAINST PRODUCTION.';
  end if;
end $$;

begin;

do $$
declare
  ada uuid := '11111111-1111-1111-1111-111111111111';
  bo uuid := '22222222-2222-2222-2222-222222222222';
  cy uuid := '33333333-3333-3333-3333-333333333333';
  dee uuid := '44444444-4444-4444-4444-444444444444';
  eve uuid := '55555555-5555-5555-5555-555555555555';
  fay uuid := '66666666-6666-6666-6666-666666666666';
  gus uuid := '77777777-7777-7777-7777-777777777777';
  today date := (now() at time zone 'America/New_York')::date;
  started_ms bigint;
  created jsonb;
  token text;
  rpc_duel uuid;
  active_duel uuid;
  completed_duel uuid;
  pending_duel uuid;
  multi_duel uuid;
  finish_duel uuid;
  worker_duel uuid;
  fay_duel uuid;
  gus_duel uuid;
  act uuid;
  board jsonb;
  day jsonb;
  ada_points int;
  bo_points int;
  listed jsonb;
  pk_cols text;
  invalid_fks int;
  orphans int;
begin
  started_ms := (extract(epoch from ((today::timestamp + time '12:00') at time zone 'America/New_York')) * 1000)::bigint;

  insert into auth.users (id, email, last_sign_in_at, raw_user_meta_data) values
    (ada, 'ada@example.test', now(), '{"display_name":"Ada"}'::jsonb),
    (bo, 'bo@example.test', now(), '{"display_name":"Bo"}'::jsonb),
    (cy, 'cy@example.test', now(), '{"display_name":"Cy"}'::jsonb),
    (dee, 'dee@example.test', now(), '{"display_name":"Dee"}'::jsonb),
    (eve, 'eve@example.test', now(), '{"display_name":"Eve"}'::jsonb),
    (fay, 'fay@example.test', now(), '{"display_name":"Fay"}'::jsonb),
    (gus, 'gus@example.test', now(), '{"display_name":"Gus"}'::jsonb);

  select string_agg(a.attname, ',' order by a.attnum) into pk_cols
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = 'public.tapact_duel_members'::regclass
    and i.indisprimary;
  if pk_cols is distinct from 'id' then
    raise exception 'DELETION TEST FAILED: members primary key is %', pk_cols;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tapact_duel_members_duel_user_key'
      and conrelid = 'public.tapact_duel_members'::regclass
  ) then
    raise exception 'DELETION TEST FAILED: membership unique key missing';
  end if;

  -- Existing invite, mapping, and presence RPCs after the primary-key change.
  perform set_config('request.jwt.claim.sub', dee::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'RPC check',
    'durationDays', 7,
    'startsOn', today,
    'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-dee'))
  ));
  rpc_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  select id into act from public.tapact_duel_activities where duel_id = rpc_duel;
  perform public.tapact_map_duel_activity(rpc_duel, act, 'read-dee-2');
  perform public.tapact_map_duel_activity(rpc_duel, act, 'read-dee-2');
  perform public.tapact_set_duel_prefs(rpc_duel, true, false);
  perform public.tapact_set_duel_presence(rpc_duel, act);
  perform public.tapact_set_duel_presence(rpc_duel, act);
  if (select tracker_activity_id from public.tapact_duel_mappings where duel_id = rpc_duel and user_id = dee) is distinct from 'read-dee-2' then
    raise exception 'DELETION TEST FAILED: mapping ON CONFLICT did not update';
  end if;
  if (select count(*) from public.tapact_duel_presence where duel_id = rpc_duel and user_id = dee) <> 1 then
    raise exception 'DELETION TEST FAILED: presence ON CONFLICT did not upsert';
  end if;
  begin
    insert into public.tapact_duel_members (duel_id, user_id, display_name, time_zone)
    values (rpc_duel, dee, 'Dee', 'America/New_York');
    raise exception 'DELETION TEST FAILED: duplicate membership was inserted';
  exception when unique_violation then
    null;
  end;
  perform set_config('request.jwt.claim.sub', eve::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/New_York');
  board := public.tapact_duel_board(rpc_duel);
  if board -> 'friend' ->> 'name' is distinct from 'Dee' then
    raise exception 'DELETION TEST FAILED: accept or board friend lookup failed';
  end if;
  listed := public.tapact_list_duels();
  if listed::text not like '%' || rpc_duel::text || '%' then
    raise exception 'DELETION TEST FAILED: list_duels missed a live membership';
  end if;

  perform set_config('request.jwt.claim.sub', ada::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Active duel', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  active_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/New_York');

  perform set_config('request.jwt.claim.sub', ada::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Completed duel', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  completed_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/Los_Angeles');

  perform set_config('request.jwt.claim.sub', ada::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Pending invite', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  pending_duel := (created ->> 'duelId')::uuid;

  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Second duel', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  multi_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', cy::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/Chicago');

  perform set_config('request.jwt.claim.sub', ada::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Finish later', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  finish_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/New_York');

  perform set_config('request.jwt.claim.sub', ada::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Worker finish', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  worker_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_accept_duel_invite(token, 'Europe/London');

  perform set_config('request.jwt.claim.sub', ada::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Guest leaves', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-ada'))
  ));
  fay_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', fay::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/New_York');

  perform set_config('request.jwt.claim.sub', gus::text, true);
  created := public.tapact_create_duel(jsonb_build_object(
    'title', 'Unprepared delete', 'durationDays', 7, 'startsOn', today, 'timeZone', 'America/New_York',
    'activities', jsonb_build_array(jsonb_build_object('name', 'Reading', 'targetMinutes', 5, 'trackerActivityId', 'read-gus'))
  ));
  gus_duel := (created ->> 'duelId')::uuid;
  token := created ->> 'token';
  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_accept_duel_invite(token, 'America/New_York');

  insert into public.tapact_activities (user_id, id, name, icon_key, color) values
    (ada, 'read-ada', 'Reading', 'book', '#336699'),
    (bo, 'read-bo', 'Reading', 'book', '#336699');
  insert into public.tapact_time_entries (user_id, id, activity_id, device_id, started_at_ms, ended_at_ms, source)
  values
    (ada, 'entry-ada', 'read-ada', 'device-ada', started_ms, started_ms + 1200000, 'timer'),
    (bo, 'entry-bo', 'read-bo', 'device-bo', started_ms, started_ms + 1200000, 'timer');
  insert into public.tapact_daily_baselines (user_id, id, source_id, day_key, activity_id, elapsed_ms)
  values (ada, 'base-ada', 'local', today, 'read-ada', 60000);

  foreach act in array array[active_duel, completed_duel]
  loop
    perform set_config('request.jwt.claim.sub', bo::text, true);
    perform public.tapact_map_duel_activity(
      act,
      (select id from public.tapact_duel_activities where duel_id = act),
      'read-bo'
    );
  end loop;

  -- Accepting after today's start moves the official date forward. Put the scored
  -- duels back on today so the noon fixture is inside the competition window.
  update public.tapact_duels
  set starts_on = today, planned_starts_on = today
  where id in (active_duel, completed_duel, fay_duel);
  update public.tapact_duels
  set starts_on = today - 8, planned_starts_on = today - 8
  where id in (finish_duel, worker_duel);
  update public.tapact_duels set status = 'completed', updated_at = now() where id = completed_duel;

  perform set_config('request.jwt.claim.sub', ada::text, true);
  ada_points := (public.tapact_duel_member_score(active_duel, ada) ->> 'points')::int;
  bo_points := (public.tapact_duel_member_score(active_duel, bo) ->> 'points')::int;
  if ada_points <> 30 or bo_points <> 30 then
    raise exception 'DELETION TEST FAILED: expected 30 points before deletion, ada %, bo %', ada_points, bo_points;
  end if;
  if (public.tapact_duel_member_score(completed_duel, ada) ->> 'points')::int <> 30 then
    raise exception 'DELETION TEST FAILED: completed duel did not score before deletion';
  end if;

  insert into public.tapact_duel_proposals (duel_id, proposer_id, base_version, payload, status)
  values (
    active_duel,
    ada,
    1,
    '{"activities":[{"name":"Reading","targetMinutes":5,"trackerActivityId":"read-ada"}],"note":"Ada private note"}'::jsonb,
    'pending'
  );
  insert into public.tapact_notifications (recipient_id, event_type, duel_id, title, body, dedupe_key) values
    (bo, 'invite_accepted', active_duel, 'Invite accepted', 'Yesterday Ada accepted your duel "Active duel" with a note.', 'legacy-accepted:' || active_duel::text),
    (bo, 'opponent_left', active_duel, 'Opponent left', 'Ada left "Active duel".', 'opponent_left:' || active_duel::text || ':' || ada::text),
    (bo, 'duel_started', active_duel, 'Duel started', 'Ada kept a private note in this sentence.', 'legacy-note:' || active_duel::text),
    (bo, 'duel_finished', active_duel, 'Duel finished', 'Player kept a private note in this sentence.', 'legacy-player:' || active_duel::text),
    (bo, 'rules_effective', active_duel, 'Rules updated', 'Reference ' || ada::text || ' stays out of history.', 'legacy-uuid:' || active_duel::text),
    (cy, 'duel_started', multi_duel, 'Duel started', 'Casey kept a shared label.', 'legacy-shared:' || multi_duel::text),
    (ada, 'duel_started', active_duel, 'Duel started', 'Your own notice.', 'own-note:' || active_duel::text);
  insert into public.tapact_push_preferences (user_id) values (ada);
  insert into public.tapact_push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values (ada, 'https://push.example.test/ada-device', repeat('a', 40), repeat('b', 16));
  insert into public.tapact_duel_characters (user_id, archetype, appearance, accent, title)
  values (ada, 'scholar', 'aurora', 'volt', 'Challenger'),
         (bo, 'warrior', 'surge', 'teal', 'Focused');

  -- incorrect email
  begin
    perform set_config('request.jwt.claim.sub', ada::text, true);
    perform public.tapact_prepare_account_deletion('wrong@example.test');
    raise exception 'DELETION TEST FAILED: incorrect email was accepted';
  exception when others then
    if sqlerrm not like '%Enter the email%' then
      raise exception 'DELETION TEST FAILED: unexpected email error: %', sqlerrm;
    end if;
  end;

  -- unauthorized account: another signed-in user cannot confirm Ada's email
  begin
    perform set_config('request.jwt.claim.sub', bo::text, true);
    perform public.tapact_prepare_account_deletion('ada@example.test');
    raise exception 'DELETION TEST FAILED: unauthorized account was accepted';
  exception when others then
    if sqlerrm not like '%Enter the email%' then
      raise exception 'DELETION TEST FAILED: unexpected unauthorized error: %', sqlerrm;
    end if;
  end;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform public.tapact_prepare_account_deletion('ada@example.test');
    raise exception 'DELETION TEST FAILED: signed-out caller was accepted';
  exception when others then
    if sqlerrm not like '%Sign in to delete%' then
      raise exception 'DELETION TEST FAILED: unexpected signed-out error: %', sqlerrm;
    end if;
  end;

  update auth.users set last_sign_in_at = now() - interval '11 minutes' where id = ada;
  begin
    perform set_config('request.jwt.claim.sub', ada::text, true);
    perform public.tapact_prepare_account_deletion('ada@example.test');
    raise exception 'DELETION TEST FAILED: stale sign-in was accepted';
  exception when others then
    if sqlerrm not like '%Sign in again%' then
      raise exception 'DELETION TEST FAILED: unexpected reauth error: %', sqlerrm;
    end if;
  end;
  update auth.users set last_sign_in_at = now() where id = ada;

  if exists (select 1 from public.tapact_duel_members where user_id = ada and display_name is distinct from 'Ada') then
    raise exception 'DELETION TEST FAILED: rejected confirmation changed a display name';
  end if;
  -- Same label on both members: a sentence cannot be attributed, so it stays.
  update public.tapact_duel_members
  set display_name = 'Casey'
  where duel_id = multi_duel;
  if not exists (select 1 from public.tapact_duels where id = pending_duel and creator_id = ada) then
    raise exception 'DELETION TEST FAILED: rejected confirmation changed the pending duel';
  end if;

  -- non-creator deletion
  perform set_config('request.jwt.claim.sub', fay::text, true);
  if (public.tapact_prepare_account_deletion('fay@example.test') ->> 'status') is distinct from 'prepared' then
    raise exception 'DELETION TEST FAILED: non-creator deletion did not prepare';
  end if;
  if not exists (
    select 1 from public.tapact_duels where id = fay_duel and creator_id = ada and status = 'active'
  ) then
    raise exception 'DELETION TEST FAILED: non-creator deletion removed or reassigned the duel';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = fay_duel and user_id is null and display_name = 'Former member' and status = 'left' and time_zone = 'America/New_York'
  ) then
    raise exception 'DELETION TEST FAILED: non-creator member was not detached';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = fay_duel and user_id = ada and display_name = 'Ada' and status = 'active'
  ) then
    raise exception 'DELETION TEST FAILED: creator membership changed when the guest left';
  end if;
  if exists (select 1 from public.tapact_duel_invites where duel_id = fay_duel and accepted_by is not null) then
    raise exception 'DELETION TEST FAILED: accepted_by still identifies the deleted guest';
  end if;
  if (public.tapact_duel_member_score(fay_duel, ada) ->> 'points')::int <> 30 then
    raise exception 'DELETION TEST FAILED: creator score changed after guest deletion';
  end if;

  -- creator deletion keeps the opponent duel
  perform set_config('request.jwt.claim.sub', ada::text, true);
  if (public.tapact_prepare_account_deletion('  Ada@Example.Test  ') ->> 'status') is distinct from 'prepared' then
    raise exception 'DELETION TEST FAILED: creator deletion did not prepare';
  end if;

  -- repeated prepare
  if (public.tapact_prepare_account_deletion('ada@example.test') ->> 'status') is distinct from 'prepared' then
    raise exception 'DELETION TEST FAILED: repeated prepare did not stay prepared';
  end if;
  if (select count(*) from public.tapact_account_deletion_requests where user_id = ada) <> 1 then
    raise exception 'DELETION TEST FAILED: repeated prepare duplicated the request';
  end if;

  if exists (select 1 from public.tapact_duels where id = pending_duel) then
    raise exception 'DELETION TEST FAILED: pending invitation survived with no other member';
  end if;
  if exists (select 1 from public.tapact_duels where id = fay_duel) then
    raise exception 'DELETION TEST FAILED: duel with no surviving member was kept';
  end if;
  if not exists (select 1 from public.tapact_duels where id = active_duel and creator_id is null and status = 'active') then
    raise exception 'DELETION TEST FAILED: active duel was removed or kept a creator';
  end if;
  if not exists (select 1 from public.tapact_duels where id = completed_duel and creator_id is null and status = 'completed') then
    raise exception 'DELETION TEST FAILED: completed duel was removed';
  end if;
  if not exists (select 1 from public.tapact_duels where id = multi_duel and creator_id is null and status = 'active') then
    raise exception 'DELETION TEST FAILED: second duel was removed';
  end if;
  if exists (select 1 from public.tapact_duels where creator_id = bo and id in (active_duel, completed_duel, multi_duel)) then
    raise exception 'DELETION TEST FAILED: creator privilege was transferred';
  end if;

  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = active_duel and user_id is null and display_name = 'Former member' and status = 'left'
      and frozen_score ->> 'points' = '30' and time_zone = 'America/New_York'
  ) then
    raise exception 'DELETION TEST FAILED: active member snapshot was not frozen';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = completed_duel and user_id is null and display_name = 'Former member' and status = 'active'
      and left_at is null and frozen_score ->> 'points' = '30' and time_zone = 'America/New_York'
  ) then
    raise exception 'DELETION TEST FAILED: completed member status was rewritten';
  end if;
  if exists (
    select 1 from public.tapact_duel_members
    where user_id = ada or display_name = 'Ada'
  ) then
    raise exception 'DELETION TEST FAILED: Ada still appears on a membership';
  end if;
  if exists (select 1 from public.tapact_duel_members where frozen_score::text like '%' || ada::text || '%' or frozen_score::text like '%@%') then
    raise exception 'DELETION TEST FAILED: frozen score contains an account identifier';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = active_duel and user_id = bo and status = 'active' and display_name = 'Bo'
  ) then
    raise exception 'DELETION TEST FAILED: surviving member row changed';
  end if;
  if (public.tapact_duel_member_score(active_duel, bo) ->> 'points')::int <> 30 then
    raise exception 'DELETION TEST FAILED: surviving live score changed';
  end if;
  if exists (
    select 1 from public.tapact_activities where user_id = ada
    union all select 1 from public.tapact_time_entries where user_id = ada
    union all select 1 from public.tapact_daily_baselines where user_id = ada
    union all select 1 from public.tapact_notifications where recipient_id = ada
    union all select 1 from public.tapact_push_subscriptions where user_id = ada
    union all select 1 from public.tapact_push_preferences where user_id = ada
    union all select 1 from public.tapact_duel_characters where user_id = ada
  ) then
    raise exception 'DELETION TEST FAILED: personal rows survived prepare';
  end if;
  if not exists (select 1 from public.tapact_activities where user_id = bo)
     or not exists (select 1 from public.tapact_time_entries where user_id = bo)
     or not exists (select 1 from public.tapact_duel_characters where user_id = bo) then
    raise exception 'DELETION TEST FAILED: opponent history was removed';
  end if;

  if exists (
    select 1 from public.tapact_duel_proposals
    where duel_id = active_duel
      and (
        proposer_id is not null
        or status <> 'withdrawn'
        or payload::text like '%trackerActivityId%'
        or payload::text like '%note%'
        or payload::text like '%Ada%'
        or payload -> 'activities' -> 0 ->> 'name' is distinct from 'Reading'
        or (payload -> 'activities' -> 0 ->> 'targetMinutes')::int is distinct from 5
      )
  ) then
    raise exception 'DELETION TEST FAILED: proposal payload was not limited to the shared rule';
  end if;
  if exists (
    select 1 from public.tapact_notifications
    where recipient_id = bo and duel_id = active_duel and event_type = 'invite_accepted'
      and body is distinct from 'Former member accepted your duel "Active duel".'
  ) then
    raise exception 'DELETION TEST FAILED: invite notice was not rebuilt from the duel title';
  end if;
  if exists (
    select 1 from public.tapact_notifications
    where recipient_id = bo and duel_id = active_duel and event_type = 'opponent_left'
      and (body is distinct from 'Former member left "Active duel".' or position(ada::text in dedupe_key) > 0)
  ) then
    raise exception 'DELETION TEST FAILED: leave notice still identifies Ada';
  end if;
  if not exists (
    select 1 from public.tapact_notifications
    where recipient_id = bo and body = 'Former member kept a private note in this sentence.'
  ) then
    raise exception 'DELETION TEST FAILED: a distinctive name remained in a free-form notice';
  end if;
  if not exists (
    select 1 from public.tapact_notifications
    where recipient_id = bo and body = 'Player kept a private note in this sentence.'
  ) then
    raise exception 'DELETION TEST FAILED: the common name Player was rewritten in unrelated text';
  end if;
  if not exists (
    select 1 from public.tapact_notifications
    where recipient_id = cy and body = 'Casey kept a shared label.'
  ) then
    raise exception 'DELETION TEST FAILED: a shared display name was rewritten';
  end if;
  if exists (
    select 1 from public.tapact_notifications
    where recipient_id <> ada and position(ada::text in body || dedupe_key) > 0
  ) then
    raise exception 'DELETION TEST FAILED: the account id remained in a surviving notice';
  end if;
  if not exists (select 1 from public.tapact_duels where id = active_duel and title = 'Active duel') then
    raise exception 'DELETION TEST FAILED: the shared duel title was removed';
  end if;

  perform set_config('request.jwt.claim.sub', bo::text, true);
  board := public.tapact_duel_board(active_duel);
  day := board -> 'friendDays' -> 0;
  if board -> 'duel' ->> 'id' is distinct from active_duel::text
     or not (board ? 'activities' and board ? 'you' and board ? 'friend' and board ? 'youDays' and board ? 'friendDays' and board ? 'presence')
     or not (board -> 'duel' ? 'title' and board -> 'duel' ? 'durationDays' and board -> 'duel' ? 'startsOn' and board -> 'duel' ? 'plannedStartsOn' and board -> 'duel' ? 'status' and board -> 'duel' ? 'final' and board -> 'duel' ? 'winner' and board -> 'duel' ? 'awaitingOpponent')
     or not (board -> 'you' ? 'name' and board -> 'you' ? 'score' and board -> 'you' ? 'status' and board -> 'you' ? 'shareLive' and board -> 'you' ? 'muted' and board -> 'you' ? 'todayKey' and board -> 'you' ? 'timeZone' and board -> 'you' ? 'character' and board -> 'you' ? 'mappings')
     or not (board -> 'friend' ? 'name' and board -> 'friend' ? 'score' and board -> 'friend' ? 'status' and board -> 'friend' ? 'timeZone' and board -> 'friend' ? 'character')
     or board -> 'friend' ->> 'name' is distinct from 'Former member'
     or (board -> 'friend' ->> 'score')::int <> 30
     or board -> 'friend' ->> 'status' is distinct from 'left'
     or board -> 'friend' ->> 'timeZone' is distinct from 'America/New_York'
     or jsonb_typeof(board -> 'friend' -> 'character') is distinct from 'null'
     or jsonb_typeof(board -> 'presence') is distinct from 'null'
     or jsonb_array_length(board -> 'friendDays') <> 7
     or not (day ? 'dayKey' and day ? 'points' and day ? 'bonus' and day ? 'activities')
     or not (day -> 'activities' -> 0 ? 'id' and day -> 'activities' -> 0 ? 'minutes' and day -> 'activities' -> 0 ? 'met' and day -> 'activities' -> 0 ? 'name' and day -> 'activities' -> 0 ? 'targetMinutes')
     or (board -> 'you' ->> 'score')::int <> 30
     or jsonb_typeof(board -> 'you' -> 'creator') is distinct from 'boolean'
     or (board -> 'you' -> 'creator')::boolean
  then
    raise exception 'DELETION TEST FAILED: active board is not a client board: %', board;
  end if;

  board := public.tapact_duel_board(completed_duel);
  if board -> 'duel' ->> 'status' is distinct from 'completed'
     or board -> 'friend' ->> 'name' is distinct from 'Former member'
     or board -> 'friend' ->> 'status' is distinct from 'active'
     or (board -> 'friend' ->> 'score')::int <> 30
     or board -> 'friend' ->> 'timeZone' is distinct from 'America/New_York'
     or jsonb_array_length(board -> 'friendDays') <> 7
     or (board -> 'you' ->> 'score')::int <> 30
  then
    raise exception 'DELETION TEST FAILED: completed board changed the historical result: %', board;
  end if;

  listed := public.tapact_list_duels();
  if not exists (
    select 1 from jsonb_array_elements(listed) item
    where item ->> 'id' = active_duel::text
      and item ->> 'memberStatus' = 'active'
      and jsonb_typeof(item -> 'creator') = 'boolean'
      and (item -> 'creator')::boolean = false
  ) then
    raise exception 'DELETION TEST FAILED: survivor list row is wrong: %', listed;
  end if;

  perform set_config('request.jwt.claim.sub', cy::text, true);
  board := public.tapact_duel_board(multi_duel);
  if board -> 'friend' ->> 'name' is distinct from 'Former member' or board -> 'friend' ->> 'timeZone' is distinct from 'America/New_York' then
    raise exception 'DELETION TEST FAILED: second duel board lost the former member';
  end if;

  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_reconcile_duel_notifications();
  if (select status from public.tapact_duels where id = finish_duel) is distinct from 'completed' then
    raise exception 'DELETION TEST FAILED: reconcile missed the detached member time zone';
  end if;
  perform public.tapact_reconcile_due_duel_notifications();
  if (select status from public.tapact_duels where id = worker_duel) is distinct from 'completed' then
    raise exception 'DELETION TEST FAILED: worker reconcile missed the detached member time zone';
  end if;

  select count(*) into invalid_fks from pg_constraint where contype = 'f' and not convalidated;
  if invalid_fks <> 0 then
    raise exception 'DELETION TEST FAILED: % foreign keys are not valid', invalid_fks;
  end if;
  select count(*) into orphans
  from public.tapact_duel_mappings map
  where not exists (
    select 1 from public.tapact_duel_members m
    where m.duel_id = map.duel_id and m.user_id = map.user_id
  );
  if orphans <> 0 then
    raise exception 'DELETION TEST FAILED: % mappings have no member', orphans;
  end if;
  select count(*) into orphans
  from public.tapact_duel_presence p
  where not exists (
    select 1 from public.tapact_duel_members m
    where m.duel_id = p.duel_id and m.user_id = p.user_id
  );
  if orphans <> 0 then
    raise exception 'DELETION TEST FAILED: % presence rows have no member', orphans;
  end if;
  begin
    insert into public.tapact_duel_mappings (duel_id, user_id, challenge_activity_id, tracker_activity_id)
    values (active_duel, '99999999-9999-9999-9999-999999999999', (select id from public.tapact_duel_activities where duel_id = active_duel), 'nope');
    raise exception 'DELETION TEST FAILED: mapping foreign key allowed an unknown member';
  exception when foreign_key_violation then
    null;
  end;
  begin
    insert into public.tapact_activities (user_id, id, name, icon_key, color)
    values (ada, 'after-delete', 'Nope', 'book', '#336699');
    raise exception 'DELETION TEST FAILED: deleted account can still insert';
  exception when others then
    if sqlerrm not like '%being deleted%' then
      raise exception 'DELETION TEST FAILED: unexpected guard error: %', sqlerrm;
    end if;
  end;

  if exists (
    select 1 from pg_constraint
    where contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype not in ('c', 'n')
  ) then
    raise exception 'DELETION TEST FAILED: an Auth foreign key can still block or restrict deletion';
  end if;

  delete from auth.users where id = ada;
  if exists (select 1 from auth.users where id = ada)
     or exists (select 1 from public.tapact_account_deletion_requests where user_id = ada)
     or not exists (select 1 from public.tapact_duels where id = active_duel and creator_id is null) then
    raise exception 'DELETION TEST FAILED: removing the prepared Auth user changed the shared duel';
  end if;

  -- Auth removal without prepare keeps the duel but does not anonymize or freeze.
  delete from auth.users where id = gus;
  if not exists (select 1 from public.tapact_duels where id = gus_duel and creator_id is null and status = 'active')
     or not exists (
       select 1 from public.tapact_duel_members
       where duel_id = gus_duel and user_id is null and display_name = 'Gus' and frozen_score is null
     )
     or not exists (select 1 from public.tapact_duel_members where duel_id = gus_duel and user_id = bo and display_name = 'Bo')
     or exists (select 1 from public.tapact_duel_mappings where duel_id = gus_duel and user_id is null) then
    raise exception 'DELETION TEST FAILED: unprepared Auth delete did not match the foreign-key result';
  end if;

  -- deletion with no surviving member, after the survivor has been checked
  perform set_config('request.jwt.claim.sub', bo::text, true);
  perform public.tapact_prepare_account_deletion('bo@example.test');
  if exists (select 1 from public.tapact_duels where id in (active_duel, completed_duel, finish_duel, worker_duel, gus_duel)) then
    raise exception 'DELETION TEST FAILED: duels remained after the last member deleted';
  end if;
  if not exists (select 1 from public.tapact_duels where id = multi_duel and status = 'active') then
    raise exception 'DELETION TEST FAILED: an unrelated survivor duel was removed';
  end if;
  if exists (select 1 from public.tapact_activities where user_id = bo) then
    raise exception 'DELETION TEST FAILED: second account history remained';
  end if;

  raise notice 'account deletion scenarios passed';
end $$;

rollback;
