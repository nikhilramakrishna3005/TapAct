-- TapAct Phase 8A.3: personal duel archive/restore and safer management RPCs.
-- Hidden rows are per member. Shared duel records, scores, and tracking stay.
-- Cancel and leave keep using the existing authorization paths. This does not
-- change point values, official start dates, or Time Rescue handling.
-- Prerequisite: 20261013170000_tapact_duel_sort_constraint_lookup.sql already
-- removed unqualified SET CONSTRAINTS from rule-edit functions. Do not add it
-- back; empty search_path cannot see that constraint.

begin;

alter table public.tapact_duel_members
  add column if not exists hidden_at timestamptz;

create or replace function public.tapact_archive_duel(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel for update;
  if d.id is null then
    raise exception 'You are not in this duel.';
  end if;
  if d.status not in ('completed', 'cancelled') then
    raise exception 'Only finished or cancelled duels can be removed from your list.';
  end if;
  update public.tapact_duel_members
  set hidden_at = coalesce(hidden_at, now())
  where duel_id = p_duel and user_id = uid;
  if not found then
    raise exception 'You are not in this duel.';
  end if;
end;
$$;

create or replace function public.tapact_restore_duel(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  update public.tapact_duel_members
  set hidden_at = null
  where duel_id = p_duel and user_id = uid and hidden_at is not null;
  if not found then
    if not exists (
      select 1 from public.tapact_duel_members where duel_id = p_duel and user_id = uid
    ) then
      raise exception 'You are not in this duel.';
    end if;
  end if;
end;
$$;

create or replace function public.tapact_revoke_duel_invite(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel for update;
  if d.id is null or d.creator_id is distinct from uid then
    raise exception 'Only an open invite can be revoked.';
  end if;
  if d.status = 'cancelled' then
    return;
  end if;
  if d.status <> 'pending' then
    raise exception 'Only an open invite can be revoked.';
  end if;
  update public.tapact_duel_invites set revoked_at = coalesce(revoked_at, now()) where duel_id = p_duel and accepted_at is null;
  update public.tapact_duels set status = 'cancelled', updated_at = now() where id = p_duel;
end;
$$;

create or replace function public.tapact_leave_duel(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel for update;
  if d.id is null then
    raise exception 'You are not in this duel.';
  end if;
  if d.status not in ('pending', 'active') then
    raise exception 'This duel is already finished.';
  end if;
  if exists (
    select 1 from public.tapact_duel_members
    where duel_id = p_duel and user_id = uid and status = 'left'
  ) then
    return;
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = p_duel and user_id = uid and status = 'active'
  ) then
    raise exception 'You are not in this duel.';
  end if;
  update public.tapact_duel_members
  set status = 'left', left_at = now(), share_live = false
  where duel_id = p_duel and user_id = uid;
  delete from public.tapact_duel_presence where duel_id = p_duel and user_id = uid;
  if d.status = 'pending' and uid = d.creator_id then
    update public.tapact_duel_invites set revoked_at = coalesce(revoked_at, now()) where duel_id = p_duel and accepted_at is null;
    update public.tapact_duels set status = 'cancelled', updated_at = now() where id = p_duel;
  else
    update public.tapact_duels set updated_at = now() where id = p_duel;
  end if;
end;
$$;

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
        'creator', d.creator_id = uid,
        'memberStatus', m.status
      ) as item
      from public.tapact_duels d
      join public.tapact_duel_members m on m.duel_id = d.id and m.user_id = uid
    ) rows
  ), '[]'::jsonb);
end;
$$;

create or replace function public.tapact_set_duel_rules(p_duel uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
  item record;
  kept uuid[] := '{}';
  seen uuid[] := '{}';
  act_id uuid;
  v_activity_name text;
  v_target_minutes int;
  v_sort_order int := 0;
  raw_id text;
  tracker text;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;

  select * into d from public.tapact_duels where id = p_duel for update;
  if d.id is null or d.creator_id is distinct from uid or d.status <> 'pending' then
    raise exception 'Shared activities can only be changed before your friend accepts.';
  end if;
  if jsonb_typeof(payload -> 'activities') <> 'array'
     or jsonb_array_length(payload -> 'activities') < 1
     or jsonb_array_length(payload -> 'activities') > 3 then
    raise exception 'Choose 1 to 3 activities.';
  end if;

  for item in select value as spec from jsonb_array_elements(payload -> 'activities')
  loop
    v_activity_name := btrim(coalesce(item.spec ->> 'name', ''));
    v_target_minutes := (item.spec ->> 'targetMinutes')::int;
    raw_id := nullif(btrim(coalesce(item.spec ->> 'id', '')), '');
    if char_length(v_activity_name) < 2 or char_length(v_activity_name) > 36 or v_target_minutes is null or v_target_minutes < 5 or v_target_minutes > 240 then
      raise exception 'Each activity needs a name and a target of 5–240 minutes.';
    end if;
    if raw_id is not null then
      if raw_id !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'That activity is not part of this duel.';
      end if;
      act_id := raw_id::uuid;
      if act_id = any(seen) then
        raise exception 'Each activity can only appear once.';
      end if;
      if not exists (
        select 1 from public.tapact_duel_activities where id = act_id and duel_id = p_duel
      ) then
        raise exception 'That activity is not part of this duel.';
      end if;
      seen := seen || act_id;
    end if;
  end loop;

  for item in select value as spec from jsonb_array_elements(payload -> 'activities')
  loop
    v_activity_name := btrim(item.spec ->> 'name');
    v_target_minutes := (item.spec ->> 'targetMinutes')::int;
    raw_id := nullif(btrim(coalesce(item.spec ->> 'id', '')), '');
    tracker := nullif(btrim(coalesce(item.spec ->> 'trackerActivityId', '')), '');
    if raw_id is not null then
      act_id := raw_id::uuid;
      update public.tapact_duel_activities
      set name = v_activity_name, target_minutes = v_target_minutes, sort_order = v_sort_order
      where id = act_id and duel_id = p_duel;
    else
      insert into public.tapact_duel_activities (duel_id, name, target_minutes, sort_order)
      values (p_duel, v_activity_name, v_target_minutes, v_sort_order)
      returning id into act_id;
      if tracker is not null then
        insert into public.tapact_duel_mappings (duel_id, user_id, challenge_activity_id, tracker_activity_id)
        values (p_duel, uid, act_id, left(tracker, 120))
        on conflict (duel_id, user_id, challenge_activity_id) do update
        set tracker_activity_id = excluded.tracker_activity_id;
      end if;
    end if;
    kept := kept || act_id;
    v_sort_order := v_sort_order + 1;
  end loop;

  delete from public.tapact_duel_activities
  where duel_id = p_duel and not (id = any(kept));

  update public.tapact_duels set updated_at = now() where id = p_duel;
end;
$$;

create or replace function public.tapact_propose_duel_rules(p_duel uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
  current_version int;
  proposal uuid;
  clean jsonb := '{"activities":[]}'::jsonb;
  item record;
  raw_id text;
  tracker text;
  seen text[] := '{}';
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel for update;
  if d.id is null or d.status <> 'active' then
    raise exception 'Rules can only change during an active duel.';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = p_duel and user_id = uid and status = 'active'
  ) then
    raise exception 'You are not in this duel.';
  end if;
  if exists (
    select 1 from public.tapact_duel_proposals where duel_id = p_duel and status = 'pending'
  ) then
    raise exception 'A change is already waiting for approval.';
  end if;

  select coalesce(max(version_no), 0) into current_version
  from public.tapact_duel_rule_versions
  where duel_id = p_duel;

  if jsonb_typeof(payload -> 'activities') <> 'array'
     or jsonb_array_length(payload -> 'activities') < 1
     or jsonb_array_length(payload -> 'activities') > 3 then
    raise exception 'Choose 1 to 3 activities.';
  end if;
  for item in select value as spec from jsonb_array_elements(payload -> 'activities')
  loop
    if char_length(btrim(coalesce(item.spec ->> 'name', ''))) < 2
       or char_length(btrim(coalesce(item.spec ->> 'name', ''))) > 36
       or (item.spec ->> 'targetMinutes')::int is null
       or (item.spec ->> 'targetMinutes')::int < 5
       or (item.spec ->> 'targetMinutes')::int > 240 then
      raise exception 'Each activity needs a name and a target of 5–240 minutes.';
    end if;
    raw_id := nullif(btrim(coalesce(item.spec ->> 'id', '')), '');
    tracker := nullif(btrim(coalesce(item.spec ->> 'trackerActivityId', '')), '');
    if raw_id is not null and (
      raw_id = any(seen)
      or raw_id !~ '^[0-9a-fA-F-]{36}$'
      or not exists (
        select 1 from public.tapact_duel_activities a
        where a.id = raw_id::uuid and a.duel_id = p_duel
      )
    ) then
      raise exception 'That activity is not part of this duel.';
    end if;
    if raw_id is not null then
      seen := seen || raw_id;
    end if;
    clean := jsonb_set(
      clean,
      '{activities}',
      (clean -> 'activities') || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'id', raw_id,
        'name', btrim(item.spec ->> 'name'),
        'targetMinutes', (item.spec ->> 'targetMinutes')::int,
        'trackerActivityId', case when raw_id is null then left(tracker, 120) else null end
      )))
    );
  end loop;

  insert into public.tapact_duel_proposals (duel_id, proposer_id, base_version, payload)
  values (p_duel, uid, current_version, clean)
  returning id into proposal;
  return proposal;
exception
  when unique_violation then
    raise exception 'A change is already waiting for approval.';
end;
$$;

create or replace function public.tapact_approve_duel_proposal(p_proposal uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prop public.tapact_duel_proposals%rowtype;
  d public.tapact_duels%rowtype;
  current_version int;
  effective date;
  item record;
  idx int := 0;
  raw_id text;
  tracker text;
  act_id uuid;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select duel_id into d.id from public.tapact_duel_proposals where id = p_proposal;
  if d.id is null then
    raise exception 'This change was already resolved.';
  end if;
  select * into d from public.tapact_duels where id = d.id for update;
  select * into prop from public.tapact_duel_proposals where id = p_proposal for update;
  if prop.id is null or prop.status <> 'pending' then
    raise exception 'This change was already resolved.';
  end if;
  if d.status <> 'active' then
    raise exception 'Rules can only change during an active duel.';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = d.id and user_id = uid and status = 'active'
  ) then
    raise exception 'You are not in this duel.';
  end if;
  if prop.proposer_id = uid then
    raise exception 'The other player has to approve this change.';
  end if;

  select coalesce(max(version_no), 0) into current_version
  from public.tapact_duel_rule_versions
  where duel_id = d.id;
  if current_version is distinct from prop.base_version then
    update public.tapact_duel_proposals
    set status = 'stale', resolved_at = now()
    where id = prop.id;
    return jsonb_build_object('stale', true);
  end if;

  effective := public.tapact_duel_next_rule_day(d.id);
  if effective is null then
    raise exception 'This duel has no remaining days for a rule change.';
  end if;

  perform public.tapact_duel_install_rules(d.id, prop.payload, effective);

  for item in select value as spec from jsonb_array_elements(prop.payload -> 'activities')
  loop
    raw_id := nullif(btrim(coalesce(item.spec ->> 'id', '')), '');
    tracker := nullif(btrim(coalesce(item.spec ->> 'trackerActivityId', '')), '');
    if raw_id is null and tracker is not null then
      select a.id into act_id
      from public.tapact_duel_activities a
      where a.duel_id = d.id and a.sort_order = idx;
      if act_id is not null then
        insert into public.tapact_duel_mappings (duel_id, user_id, challenge_activity_id, tracker_activity_id)
        values (d.id, prop.proposer_id, act_id, left(tracker, 120))
        on conflict (duel_id, user_id, challenge_activity_id) do update
        set tracker_activity_id = excluded.tracker_activity_id;
      end if;
    end if;
    idx := idx + 1;
  end loop;

  update public.tapact_duel_proposals
  set status = 'approved', effective_on = effective, resolved_at = now()
  where id = prop.id;
  update public.tapact_duels set updated_at = now() where id = d.id;
  return jsonb_build_object('effectiveOn', effective);
end;
$$;

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
  select * into friend from public.tapact_duel_members where duel_id = p_duel and user_id <> uid limit 1;

  you_score := public.tapact_duel_member_score(p_duel, uid);
  if friend.user_id is not null then
    friend_score := public.tapact_duel_member_score(p_duel, friend.user_id);
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
    if friend.status = 'active' and friend.share_live and not me.muted then
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
      'status', d.status, 'final', final, 'winner', winner, 'awaitingOpponent', friend.user_id is null and d.status = 'pending'
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
      'creator', me.user_id = d.creator_id,
      'todayKey', (now() at time zone me.time_zone)::date,
      'mappings', coalesce((
        select jsonb_agg(jsonb_build_object('challengeActivityId', map.challenge_activity_id, 'trackerActivityId', map.tracker_activity_id))
        from public.tapact_duel_mappings map
        where map.duel_id = p_duel and map.user_id = uid
      ), '[]'::jsonb)
    ),
    'friend', case when friend.user_id is null then null else jsonb_build_object(
      'name', friend.display_name, 'score', coalesce((friend_score ->> 'points')::int, 0), 'status', friend.status
    ) end,
    'youDays', you_score -> 'days',
    'friendDays', case when friend.user_id is null then '[]'::jsonb else friend_score -> 'days' end,
    'presence', presence
  );
end;
$$;

revoke all on function public.tapact_archive_duel(uuid) from public, anon;
revoke all on function public.tapact_restore_duel(uuid) from public, anon;
revoke all on function public.tapact_revoke_duel_invite(uuid) from public, anon;
revoke all on function public.tapact_leave_duel(uuid) from public, anon;
revoke all on function public.tapact_list_duels() from public, anon;
revoke all on function public.tapact_set_duel_rules(uuid, jsonb) from public, anon;
revoke all on function public.tapact_propose_duel_rules(uuid, jsonb) from public, anon;
revoke all on function public.tapact_approve_duel_proposal(uuid) from public, anon;
revoke all on function public.tapact_duel_board(uuid) from public, anon;

grant execute on function public.tapact_archive_duel(uuid) to authenticated;
grant execute on function public.tapact_restore_duel(uuid) to authenticated;
grant execute on function public.tapact_revoke_duel_invite(uuid) to authenticated;
grant execute on function public.tapact_leave_duel(uuid) to authenticated;
grant execute on function public.tapact_list_duels() to authenticated;
grant execute on function public.tapact_set_duel_rules(uuid, jsonb) to authenticated;
grant execute on function public.tapact_propose_duel_rules(uuid, jsonb) to authenticated;
grant execute on function public.tapact_approve_duel_proposal(uuid) to authenticated;
grant execute on function public.tapact_duel_board(uuid) to authenticated;

commit;
