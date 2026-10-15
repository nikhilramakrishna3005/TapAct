-- TapAct Phase 10C.2A: prepare safe account deletion. DO NOT APPLY until reviewed.
--
-- This migration does not delete any account. It changes foreign keys so removing
-- an Auth user cannot erase a shared duel, and it adds tapact_prepare_account_deletion
-- for the signed-in user only.
--
-- Auth identity removal is a later server step. auth.admin.deleteUser cannot share
-- this function's transaction. The prepare function is one transaction. The Auth
-- delete is a second, retryable step. This file does not perform that second step
-- and does not grant it to the browser.
--
-- The eventual backend route (not implemented here):
-- 1. Accept only the caller's Supabase user JWT. Never take a user id from the body.
-- 2. Require the caller to type their account email. prepare compares it to auth.users.email.
-- 3. Require a fresh sign-in first. prepare rejects last_sign_in_at older than 10 minutes.
-- 4. After prepare returns status "prepared", call auth.admin.deleteUser for that same
--    uid with the service role, only on the server.
-- 5. If deleteUser fails, return an error. The identity still exists, so the user can
--    sign in again, call prepare again (it is idempotent), and the route retries
--    deleteUser. The deletion-request row blocks new personal writes until Auth is gone.
-- 6. Previously delivered push notifications cannot be recalled and stay outside this guarantee.
--
-- Scoring math is unchanged. tapact_duel_member_score is not replaced. After a
-- member is detached, the board reads the jsonb that function already returned.
--
-- Rollback before any account has been prepared: drop the new function, triggers,
-- request table, and frozen_score column, then restore the previous foreign keys
-- (creator and member user_id ON DELETE CASCADE, proposer ON DELETE CASCADE,
-- accepted_by with no ON DELETE action) and the original members primary key.
-- After a prepare call has committed, personal rows and the later Auth identity
-- cannot be restored by rolling this migration back.

begin;

-- Shared duel must survive deletion of the creator's Auth identity.
alter table public.tapact_duels alter column creator_id drop not null;

alter table public.tapact_duels drop constraint if exists tapact_duels_creator_id_fkey;
alter table public.tapact_duels
  add constraint tapact_duels_creator_id_fkey
  foreign key (creator_id) references auth.users (id) on delete set null;

-- A detached member row has no Auth identity. The primary key cannot include null,
-- so membership gains its own id. (duel_id, user_id) stays unique for live members.
-- PostgreSQL unique constraints allow more than one null user_id.
alter table public.tapact_duel_members
  add column if not exists id uuid not null default extensions.gen_random_uuid();

alter table public.tapact_duel_members
  add column if not exists frozen_score jsonb;

alter table public.tapact_duel_members
  drop constraint if exists tapact_duel_members_frozen_score_obj;
alter table public.tapact_duel_members
  add constraint tapact_duel_members_frozen_score_obj
  check (frozen_score is null or jsonb_typeof(frozen_score) = 'object');

alter table public.tapact_duel_members
  add constraint tapact_duel_members_duel_user_key unique (duel_id, user_id);

do $$
declare
  child record;
begin
  for child in
    select con.conname, con.conrelid::regclass as table_name
    from pg_constraint con
    where con.contype = 'f'
      and con.confrelid = 'public.tapact_duel_members'::regclass
  loop
    execute format('alter table %s drop constraint %I', child.table_name, child.conname);
  end loop;
end $$;

alter table public.tapact_duel_members drop constraint tapact_duel_members_pkey;
alter table public.tapact_duel_members add constraint tapact_duel_members_pkey primary key (id);

alter table public.tapact_duel_mappings
  add constraint tapact_duel_mappings_member_fkey
  foreign key (duel_id, user_id)
  references public.tapact_duel_members (duel_id, user_id)
  on delete cascade;

alter table public.tapact_duel_presence
  add constraint tapact_duel_presence_member_fkey
  foreign key (duel_id, user_id)
  references public.tapact_duel_members (duel_id, user_id)
  on delete cascade;

alter table public.tapact_duel_members alter column user_id drop not null;
alter table public.tapact_duel_members drop constraint if exists tapact_duel_members_user_id_fkey;
alter table public.tapact_duel_members
  add constraint tapact_duel_members_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- Proposal history is shared. Detach the proposer instead of deleting the row.
alter table public.tapact_duel_proposals alter column proposer_id drop not null;
alter table public.tapact_duel_proposals drop constraint if exists tapact_duel_proposals_proposer_id_fkey;
alter table public.tapact_duel_proposals
  add constraint tapact_duel_proposals_proposer_id_fkey
  foreign key (proposer_id) references auth.users (id) on delete set null;

-- accepted_by previously had no ON DELETE action, so Auth deletion could fail.
alter table public.tapact_duel_invites drop constraint if exists tapact_duel_invites_accepted_by_fkey;
alter table public.tapact_duel_invites
  add constraint tapact_duel_invites_accepted_by_fkey
  foreign key (accepted_by) references auth.users (id) on delete set null;

-- Exists only until the Auth identity is removed. Cascade deletes the receipt.
create table if not exists public.tapact_account_deletion_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  prepared_at timestamptz not null default now()
);

alter table public.tapact_account_deletion_requests enable row level security;
alter table public.tapact_account_deletion_requests force row level security;
revoke all on public.tapact_account_deletion_requests from anon, authenticated;

-- Clear personal links before user_id becomes null, including the Auth SET NULL path.
create or replace function public.tapact_duel_member_detach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null then
    delete from public.tapact_duel_presence
    where duel_id = old.duel_id and user_id = old.user_id;
    delete from public.tapact_duel_mappings
    where duel_id = old.duel_id and user_id = old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tapact_duel_member_detach on public.tapact_duel_members;
create trigger tapact_duel_member_detach
  before update of user_id on public.tapact_duel_members
  for each row
  execute function public.tapact_duel_member_detach();

revoke all on function public.tapact_duel_member_detach() from public, anon, authenticated;

-- Auth deletion runs as supabase_auth_admin. It must be able to fire the detach trigger.
do $$
declare
  admin_role text;
begin
  foreach admin_role in array array['supabase_auth_admin', 'service_role']
  loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = admin_role) then
      execute format(
        'grant execute on function public.tapact_duel_member_detach() to %I',
        admin_role
      );
    end if;
  end loop;
end $$;

-- Block new personal rows after prepare commits and before Auth deletion retries.
create or replace function public.tapact_block_deleted_account_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  -- Separate statements. A SQL CASE reads every NEW field it mentions, so
  -- notifications and the other tables cannot share one expression.
  if tg_table_name = 'tapact_notifications' then
    target := new.recipient_id;
  else
    target := new.user_id;
  end if;
  if target is not null and exists (
    select 1
    from public.tapact_account_deletion_requests r
    where r.user_id = target
  ) then
    raise exception 'This account is being deleted.';
  end if;
  return new;
end;
$$;

revoke all on function public.tapact_block_deleted_account_write() from public, anon;
grant execute on function public.tapact_block_deleted_account_write() to authenticated;

do $$
declare
  guarded text;
begin
  foreach guarded in array array[
    'tapact_activities',
    'tapact_time_entries',
    'tapact_daily_baselines',
    'tapact_duel_members',
    'tapact_push_preferences',
    'tapact_push_subscriptions',
    'tapact_duel_characters',
    'tapact_notifications'
  ]
  loop
    execute format('drop trigger if exists tapact_block_deleted_account_write on public.%I', guarded);
    execute format(
      'create trigger tapact_block_deleted_account_write before insert on public.%I for each row execute function public.tapact_block_deleted_account_write()',
      guarded
    );
  end loop;
end $$;

create or replace function public.tapact_prepare_account_deletion(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_signin timestamptz;
  mine uuid[];
  names text[];
  v_name text;
  v_pattern text;
begin
  if uid is null then
    raise exception 'Sign in to delete your account.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('tapact-account-deletion'),
    pg_catalog.hashtext(uid::text)
  );

  select u.email, u.last_sign_in_at
  into v_email, v_signin
  from auth.users u
  where u.id = uid
  for update;

  if v_email is null or char_length(btrim(p_confirm)) > 320
     or lower(btrim(p_confirm)) is distinct from lower(btrim(v_email)) then
    raise exception 'Enter the email on this account to confirm deletion.';
  end if;
  if v_signin is null or v_signin < now() - interval '10 minutes' then
    raise exception 'Sign in again, then confirm deletion.';
  end if;

  select coalesce(array_agg(m.duel_id), '{}'), coalesce(array_agg(distinct m.display_name), '{}')
  into mine, names
  from public.tapact_duel_members m
  where m.user_id = uid;

  -- Snapshot uses the existing scorer, before membership or sessions change.
  update public.tapact_duel_members m
  set frozen_score = public.tapact_duel_member_score(m.duel_id, m.user_id)
  where m.user_id = uid
    and m.frozen_score is null;

  update public.tapact_duel_invites i
  set revoked_at = coalesce(i.revoked_at, now())
  from public.tapact_duels d
  where i.duel_id = d.id
    and d.creator_id = uid
    and i.accepted_at is null
    and i.revoked_at is null;

  -- Keep the shared rule proposal (activity name and target). Drop notes,
  -- private tracker ids, and any other personal keys.
  update public.tapact_duel_proposals p
  set
    status = case when p.status = 'pending' then 'withdrawn' else p.status end,
    resolved_at = case when p.status = 'pending' then coalesce(p.resolved_at, now()) else p.resolved_at end,
    proposer_id = null,
    payload = jsonb_build_object(
      'activities',
      coalesce(
        (
          select jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'id', item -> 'id',
              'name', item -> 'name',
              'targetMinutes', item -> 'targetMinutes'
            ))
          )
          from jsonb_array_elements(
            case
              when jsonb_typeof(p.payload -> 'activities') = 'array' then p.payload -> 'activities'
              else '[]'::jsonb
            end
          ) item
        ),
        '[]'::jsonb
      )
    )
  where p.proposer_id = uid;

  update public.tapact_duel_invites
  set accepted_by = null
  where accepted_by = uid;

  -- Keep user_id for this update so the departure trigger can still see the opponent.
  -- The new notice uses the anonymized name. A second update then detaches Auth.
  -- Only an active duel becomes "left". Completed and cancelled rows keep their
  -- status so Arena and recap do not describe a finished member as having quit.
  update public.tapact_duel_members m
  set
    display_name = 'Former member',
    status = case
      when m.status = 'left' then 'left'
      when d.status = 'active' then 'left'
      else m.status
    end,
    left_at = case
      when m.status = 'left' or d.status = 'active' then coalesce(m.left_at, now())
      else m.left_at
    end,
    share_live = false
  from public.tapact_duels d
  where m.duel_id = d.id
    and m.user_id = uid;

  -- Notices that always name the actor are rebuilt from the duel title.
  -- This does not search for the display name, so "Player" is not rewritten
  -- just because it appears in an unrelated sentence.
  update public.tapact_notifications n
  set body = left(
    case n.event_type
      when 'invite_accepted' then 'Former member accepted your duel "' || d.title || '".'
      when 'opponent_left' then 'Former member left "' || d.title || '".'
      when 'proposal_received' then 'Former member proposed a change to "' || d.title || '".'
      when 'proposal_approved' then 'Former member approved your changes to "' || d.title || '".'
      when 'proposal_rejected' then 'Former member declined your changes to "' || d.title || '".'
      else n.body
    end,
    240
  )
  from public.tapact_duels d
  where n.duel_id = d.id
    and n.duel_id = any(mine)
    and n.recipient_id <> uid
    and n.event_type in (
      'invite_accepted',
      'opponent_left',
      'proposal_received',
      'proposal_approved',
      'proposal_rejected'
    );

  -- A distinctive display name can still sit in a free-form sentence. Skip
  -- "Player" and "Former member", and skip a name the other member also uses,
  -- because that sentence cannot be attributed to one person.
  foreach v_name in array names
  loop
    if v_name is null or char_length(btrim(v_name)) < 3 then
      continue;
    end if;
    if lower(btrim(v_name)) in ('player', 'former member') then
      continue;
    end if;
    v_pattern := '\m' || regexp_replace(btrim(v_name), '([^[:alnum:]_])', '\\\1', 'g') || '\M';
    update public.tapact_notifications n
    set body = left(regexp_replace(n.body, v_pattern, 'Former member', 'g'), 240)
    where n.duel_id = any(mine)
      and n.recipient_id <> uid
      and not exists (
        select 1
        from public.tapact_duel_members m
        where m.duel_id = n.duel_id
          and m.user_id is distinct from uid
          and lower(btrim(m.display_name)) = lower(btrim(v_name))
      );
  end loop;

  update public.tapact_notifications n
  set
    body = left(
      case
        when char_length(btrim(replace(n.body, uid::text, ''))) = 0 then 'Former member'
        else replace(n.body, uid::text, '')
      end,
      240
    ),
    dedupe_key = case
      when position(uid::text in n.dedupe_key) > 0 then left('former:' || n.id::text, 160)
      else n.dedupe_key
    end
  where n.duel_id = any(mine)
    and n.recipient_id <> uid
    and (
      position(uid::text in n.body) > 0
      or position(uid::text in n.dedupe_key) > 0
    );

  update public.tapact_duel_members
  set user_id = null
  where user_id = uid;

  delete from public.tapact_duels d
  where d.id = any(mine)
    and not exists (
      select 1
      from public.tapact_duel_members m
      where m.duel_id = d.id
        and m.user_id is not null
    );

  -- Do not assign creator to the other member. Creator checks then fail closed.
  update public.tapact_duels
  set creator_id = null, updated_at = now()
  where creator_id = uid;

  delete from public.tapact_notifications where recipient_id = uid;
  delete from public.tapact_push_subscriptions where user_id = uid;
  delete from public.tapact_push_preferences where user_id = uid;
  delete from public.tapact_duel_characters where user_id = uid;
  delete from public.tapact_activities where user_id = uid;

  insert into public.tapact_account_deletion_requests (user_id)
  values (uid)
  on conflict (user_id) do update
  set prepared_at = now();

  return jsonb_build_object('status', 'prepared');
end;
$$;

revoke all on function public.tapact_prepare_account_deletion(text) from public, anon;
grant execute on function public.tapact_prepare_account_deletion(text) to authenticated;

-- A detached opponent still appears on the board. Live members keep live scores.
create or replace function public.tapact_duel_board(p_duel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
  me public.tapact_duel_members%rowtype;
  friend public.tapact_duel_members%rowtype;
  you_score jsonb;
  friend_score jsonb;
  final boolean := false;
  later timestamptz;
  winner text;
  presence jsonb := null;
  friend_zone text;
  latest_on date;
begin
  if uid is null or not public.tapact_duel_is_member(p_duel) then
    raise exception 'You are not in this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel;
  select * into me from public.tapact_duel_members where duel_id = p_duel and user_id = uid;
  select * into friend
  from public.tapact_duel_members
  where duel_id = p_duel
    and id is distinct from me.id
  limit 1;

  you_score := public.tapact_duel_member_score(p_duel, uid);
  if friend.id is not null then
    if friend.frozen_score is not null then
      friend_score := friend.frozen_score;
    elsif friend.user_id is not null then
      friend_score := public.tapact_duel_member_score(p_duel, friend.user_id);
    else
      friend_score := jsonb_build_object('points', 0, 'days', '[]'::jsonb);
    end if;
    friend_zone := friend.time_zone;
    later := greatest(
      (d.starts_on + d.duration_days)::timestamp at time zone me.time_zone,
      (d.starts_on + d.duration_days)::timestamp at time zone friend_zone
    );
    final := d.status <> 'cancelled' and now() >= later;
    if final and d.status = 'active' then
      update public.tapact_duels set status = 'completed', updated_at = now() where id = p_duel and status = 'active';
      d.status := 'completed';
    end if;
    if final then
      if (you_score ->> 'points')::int = (friend_score ->> 'points')::int then
        winner := 'tie';
      elsif (you_score ->> 'points')::int > (friend_score ->> 'points')::int then
        winner := 'you';
      else
        winner := 'friend';
      end if;
    end if;
    if friend.user_id is not null and friend.status = 'active' and friend.share_live and not me.muted then
      select jsonb_build_object('name', friend.display_name, 'activity', a.name, 'activityId', a.id)
      into presence
      from public.tapact_duel_presence p
      join public.tapact_duel_activities a on a.id = p.challenge_activity_id
      where p.duel_id = p_duel and p.user_id = friend.user_id and p.updated_at > now() - interval '3 hours';
    end if;
  end if;

  select v.effective_on into latest_on
  from public.tapact_duel_rule_versions v
  where v.duel_id = p_duel
  order by v.version_no desc
  limit 1;

  return jsonb_build_object(
    'duel', jsonb_build_object(
      'id', d.id, 'title', d.title, 'durationDays', d.duration_days, 'startsOn', d.starts_on,
      'plannedStartsOn', d.planned_starts_on,
      'status', d.status, 'final', final, 'winner', winner, 'awaitingOpponent', friend.id is null and d.status = 'pending'
    ),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.activity_id, 'name', i.name, 'targetMinutes', i.target_minutes) order by i.sort_order)
      from public.tapact_duel_rule_items i
      join public.tapact_duel_rule_versions v on v.id = i.version_id
      where v.duel_id = p_duel
        and v.version_no = (select max(version_no) from public.tapact_duel_rule_versions where duel_id = p_duel)
    ), (
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'targetMinutes', a.target_minutes) order by a.sort_order)
      from public.tapact_duel_activities a where a.duel_id = p_duel
    ), '[]'::jsonb),
    'rulesEffectiveOn', latest_on,
    'proposal', (
      select jsonb_build_object(
        'id', p.id,
        'mine', p.proposer_id = uid,
        'activities', p.payload -> 'activities',
        'createdAt', p.created_at
      )
      from public.tapact_duel_proposals p
      where p.duel_id = p_duel and p.status = 'pending'
      limit 1
    ),
    'you', jsonb_build_object(
      'name', me.display_name, 'score', coalesce((you_score ->> 'points')::int, 0),
      'status', me.status, 'shareLive', me.share_live, 'muted', me.muted,
      'creator', (me.user_id = d.creator_id) is true,
      'todayKey', (now() at time zone me.time_zone)::date,
      'timeZone', me.time_zone,
      'character', public.tapact_duel_public_character(uid),
      'mappings', coalesce((
        select jsonb_agg(jsonb_build_object('challengeActivityId', map.challenge_activity_id, 'trackerActivityId', map.tracker_activity_id))
        from public.tapact_duel_mappings map
        where map.duel_id = p_duel and map.user_id = uid
      ), '[]'::jsonb)
    ),
    'friend', case when friend.id is null then null else jsonb_build_object(
      'name', friend.display_name,
      'score', coalesce((friend_score ->> 'points')::int, 0),
      'status', friend.status,
      'timeZone', friend.time_zone,
      'character', case
        when friend.user_id is null then null
        else public.tapact_duel_public_character(friend.user_id)
      end
    ) end,
    'youDays', you_score -> 'days',
    'friendDays', case when friend.id is null then '[]'::jsonb else friend_score -> 'days' end,
    'presence', presence
  );
end;
$$;

revoke all on function public.tapact_duel_board(uuid) from public, anon;
grant execute on function public.tapact_duel_board(uuid) to authenticated;

-- creator_id = uid is null after the creator is detached. Return a real boolean.
create or replace function public.tapact_list_duels()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(item order by
      case item ->> 'status'
        when 'active' then 0
        when 'pending' then 1
        when 'completed' then 2
        else 3
      end,
      item ->> 'startsOn' desc
    )
    from (
      select jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'status', d.status,
        'startsOn', d.starts_on,
        'durationDays', d.duration_days,
        'awaitingOpponent', d.status = 'pending',
        'archived', m.hidden_at is not null,
        'creator', (d.creator_id = uid) is true,
        'memberStatus', m.status
      ) as item
      from public.tapact_duels d
      join public.tapact_duel_members m on m.duel_id = d.id and m.user_id = uid
    ) rows
  ), '[]'::jsonb);
end;
$$;

-- Completion still needs the detached member's saved time zone. user_id <> uid
-- does not match a null user_id, so an active duel would never finish.
create or replace function public.tapact_reconcile_duel_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  duel_id uuid;
  d public.tapact_duels%rowtype;
  my_zone text;
  friend_zone text;
  later timestamptz;
  member record;
  rule record;
  reader record;
begin
  if uid is null then
    return;
  end if;

  for duel_id in
    select d0.id
    from public.tapact_duels d0
    join public.tapact_duel_members mine
      on mine.duel_id = d0.id and mine.user_id = uid
    where d0.status = 'active'
    order by d0.id
  loop
    select * into d from public.tapact_duels where id = duel_id for update;
    if d.id is null or d.status is distinct from 'active' then
      continue;
    end if;

    select m.time_zone into my_zone
    from public.tapact_duel_members m
    where m.duel_id = d.id and m.user_id = uid;

    for member in
      select m.user_id, m.time_zone
      from public.tapact_duel_members m
      where m.duel_id = d.id
    loop
      if member.user_id is not null
         and (now() at time zone member.time_zone)::date >= d.starts_on then
        perform public.tapact_emit_notification(
          member.user_id,
          'duel_started',
          d.id,
          null,
          'Duel started',
          '"' || d.title || '" has officially started.',
          'duel_started:' || d.id::text
        );
      end if;
    end loop;

    for rule in
      select p.id, p.effective_on
      from public.tapact_duel_proposals p
      where p.duel_id = d.id
        and p.status = 'approved'
        and p.effective_on is not null
    loop
      for reader in
        select m.user_id, m.time_zone
        from public.tapact_duel_members m
        where m.duel_id = d.id
          and m.user_id is not null
      loop
        if (now() at time zone reader.time_zone)::date >= rule.effective_on then
          perform public.tapact_emit_notification(
            reader.user_id,
            'rules_effective',
            d.id,
            rule.id,
            'Rules updated',
            'New rules for "' || d.title || '" are in effect.',
            'rules_effective:' || rule.id::text
          );
        end if;
      end loop;
    end loop;

    select f.time_zone into friend_zone
    from public.tapact_duel_members f
    where f.duel_id = d.id
      and f.user_id is distinct from uid
    limit 1;

    if friend_zone is not null and my_zone is not null then
      later := greatest(
        (d.starts_on + d.duration_days)::timestamp at time zone my_zone,
        (d.starts_on + d.duration_days)::timestamp at time zone friend_zone
      );
      if now() >= later then
        update public.tapact_duels
        set status = 'completed', updated_at = now()
        where id = d.id and status = 'active';
      end if;
    end if;
  end loop;
end;
$$;

commit;
