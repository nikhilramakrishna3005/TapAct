-- TapAct Phase 8A.2: shared duel rules are versioned by the day they take effect.
-- An approved change starts on the next day that has not begun for either player.
-- Earlier days keep the targets and activity set from the version in force then.
-- This does not change point values, official start dates, or Time Rescue handling.

begin;

create table if not exists public.tapact_duel_rule_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  effective_on date not null,
  created_at timestamptz not null default now(),
  unique (duel_id, version_no),
  unique (duel_id, effective_on)
);

create table if not exists public.tapact_duel_rule_items (
  version_id uuid not null references public.tapact_duel_rule_versions (id) on delete cascade,
  activity_id uuid not null,
  name text not null check (char_length(name) between 2 and 36),
  target_minutes integer not null check (target_minutes between 5 and 240),
  sort_order integer not null check (sort_order between 0 and 2),
  primary key (version_id, activity_id),
  unique (version_id, sort_order)
);

create table if not exists public.tapact_duel_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  proposer_id uuid not null references auth.users (id) on delete cascade,
  base_version integer not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'stale')),
  effective_on date,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists tapact_duel_one_pending_proposal
  on public.tapact_duel_proposals (duel_id)
  where status = 'pending';

-- Keep mapping rows after a shared activity is removed so earlier days can still score.
-- The membership foreign key stays. Only the link to the live activity row is relaxed.
do $$
declare
  cname text;
begin
  select con.conname into strict cname
  from pg_constraint con
  where con.contype = 'f'
    and con.conrelid = 'public.tapact_duel_mappings'::regclass
    and con.confrelid = 'public.tapact_duel_activities'::regclass;
  execute format('alter table public.tapact_duel_mappings drop constraint %I', cname);
exception
  when no_data_found or too_many_rows then
    raise exception 'Expected exactly one activity foreign key on tapact_duel_mappings.';
end $$;

insert into public.tapact_duel_rule_versions (duel_id, version_no, effective_on)
select d.id, 1, d.starts_on
from public.tapact_duels d
where not exists (
  select 1 from public.tapact_duel_rule_versions v where v.duel_id = d.id
);

insert into public.tapact_duel_rule_items (version_id, activity_id, name, target_minutes, sort_order)
select v.id, a.id, a.name, a.target_minutes, a.sort_order
from public.tapact_duel_activities a
join public.tapact_duel_rule_versions v on v.duel_id = a.duel_id and v.version_no = 1
where not exists (
  select 1 from public.tapact_duel_rule_items i where i.version_id = v.id and i.activity_id = a.id
);

-- While a duel is still pending, the creator's direct edits are the only version.
create or replace function public.tapact_duel_sync_pending_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  duel uuid := coalesce(new.duel_id, old.duel_id);
  d public.tapact_duels%rowtype;
  ver uuid;
begin
  select * into d from public.tapact_duels where id = duel;
  if d.status is distinct from 'pending' then
    return null;
  end if;
  if (select count(*) from public.tapact_duel_rule_versions where duel_id = duel) > 1 then
    return null;
  end if;

  select id into ver
  from public.tapact_duel_rule_versions
  where duel_id = duel and version_no = 1;

  if ver is null then
    insert into public.tapact_duel_rule_versions (duel_id, version_no, effective_on)
    values (duel, 1, d.starts_on)
    returning id into ver;
  else
    update public.tapact_duel_rule_versions set effective_on = d.starts_on where id = ver;
    delete from public.tapact_duel_rule_items where version_id = ver;
  end if;

  insert into public.tapact_duel_rule_items (version_id, activity_id, name, target_minutes, sort_order)
  select ver, a.id, a.name, a.target_minutes, a.sort_order
  from public.tapact_duel_activities a
  where a.duel_id = duel;

  delete from public.tapact_duel_mappings m
  where m.duel_id = duel
    and not exists (
      select 1 from public.tapact_duel_activities a where a.id = m.challenge_activity_id and a.duel_id = duel
    );

  return null;
end;
$$;

drop trigger if exists tapact_duel_activities_sync_pending on public.tapact_duel_activities;
create trigger tapact_duel_activities_sync_pending
  after insert or update or delete on public.tapact_duel_activities
  for each row execute function public.tapact_duel_sync_pending_rules();

create or replace function public.tapact_duel_next_rule_day(p_duel uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.tapact_duels%rowtype;
  tomorrow date := null;
  zone text;
  local_today date;
  effective date;
begin
  select * into d from public.tapact_duels where id = p_duel;
  if d.id is null then
    return null;
  end if;
  for zone in
    select m.time_zone from public.tapact_duel_members m where m.duel_id = p_duel
  loop
    local_today := (now() at time zone zone)::date;
    tomorrow := greatest(coalesce(tomorrow, local_today + 1), local_today + 1);
  end loop;
  if tomorrow is null then
    return null;
  end if;
  effective := greatest(tomorrow, d.starts_on);
  if effective >= d.starts_on + d.duration_days then
    return null;
  end if;
  return effective;
end;
$$;

create or replace function public.tapact_duel_member_score(p_duel uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.tapact_duels%rowtype;
  m public.tapact_duel_members%rowtype;
  act record;
  day date;
  ver uuid;
  totals jsonb;
  tracked int;
  met boolean;
  met_count int;
  activity_count int;
  day_points int;
  bonus boolean;
  points int := 0;
  days jsonb := '[]'::jsonb;
  activities jsonb;
  target int;
begin
  select * into d from public.tapact_duels where id = p_duel;
  select * into m from public.tapact_duel_members where duel_id = p_duel and user_id = p_user;
  if d.id is null or m.user_id is null then
    return jsonb_build_object('points', 0, 'days', '[]'::jsonb);
  end if;

  for day in
    select generate_series(d.starts_on, d.starts_on + (d.duration_days - 1), interval '1 day')::date
  loop
    met_count := 0;
    activities := '[]'::jsonb;
    select v.id into ver
    from public.tapact_duel_rule_versions v
    where v.duel_id = p_duel and v.effective_on <= day
    order by v.effective_on desc, v.version_no desc
    limit 1;

    for act in
      select src.id, src.activity_name, src.target_minutes, map.tracker_activity_id
      from (
        select i.activity_id as id, i.name as activity_name, i.target_minutes, i.sort_order
        from public.tapact_duel_rule_items i
        where i.version_id = ver
        union all
        select a.id, a.name, a.target_minutes, a.sort_order
        from public.tapact_duel_activities a
        where ver is null and a.duel_id = p_duel
      ) src
      left join public.tapact_duel_mappings map
        on map.challenge_activity_id = src.id and map.user_id = p_user and map.duel_id = p_duel
      order by src.sort_order
    loop
      if d.status = 'pending' then
        totals := '{}'::jsonb;
      else
        totals := public.tapact_duel_timer_minutes(
          p_user, act.tracker_activity_id, m.time_zone, d.starts_on, d.starts_on + d.duration_days, m.left_at
        );
      end if;
      tracked := floor(coalesce((totals ->> day::text)::bigint, 0) / 60000.0);
      target := act.target_minutes;
      met := act.tracker_activity_id is not null and tracked >= target;
      if met then
        met_count := met_count + 1;
      end if;
      activities := activities || jsonb_build_array(jsonb_build_object(
        'id', act.id, 'name', act.activity_name, 'targetMinutes', target, 'minutes', tracked, 'met', met
      ));
    end loop;

    select count(*) into activity_count
    from (
      select i.activity_id from public.tapact_duel_rule_items i where i.version_id = ver
      union all
      select a.id from public.tapact_duel_activities a where ver is null and a.duel_id = p_duel
    ) counted;
    bonus := met_count > 0 and met_count = activity_count;
    day_points := met_count * 20 + case when bonus then 10 else 0 end;
    points := points + day_points;
    days := days || jsonb_build_array(jsonb_build_object(
      'dayKey', day, 'points', day_points, 'bonus', bonus, 'activities', activities
    ));
  end loop;
  return jsonb_build_object('points', points, 'days', days);
end;
$$;

create or replace function public.tapact_duel_install_rules(p_duel uuid, payload jsonb, p_effective date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  idx int := 0;
  kept uuid[] := '{}';
  seen uuid[] := '{}';
  act_id uuid;
  v_activity_name text;
  v_target_minutes int;
  ver uuid;
  ver_no int;
  raw_id text;
begin
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
    if char_length(v_activity_name) < 2 or char_length(v_activity_name) > 36
       or v_target_minutes is null or v_target_minutes < 5 or v_target_minutes > 240 then
      raise exception 'Each activity needs a name and a target of 5–240 minutes.';
    end if;
    if raw_id is not null then
      if raw_id !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'That activity is not part of this duel.';
      end if;
      act_id := raw_id::uuid;
      if act_id = any(seen) or not exists (
        select 1 from public.tapact_duel_activities where id = act_id and duel_id = p_duel
      ) then
        raise exception 'That activity is not part of this duel.';
      end if;
      seen := seen || act_id;
    end if;
  end loop;

  select id, version_no into ver, ver_no
  from public.tapact_duel_rule_versions
  where duel_id = p_duel and effective_on = p_effective;

  if ver is null then
    select coalesce(max(version_no), 0) + 1 into ver_no
    from public.tapact_duel_rule_versions
    where duel_id = p_duel;
    insert into public.tapact_duel_rule_versions (duel_id, version_no, effective_on)
    values (p_duel, ver_no, p_effective)
    returning id into ver;
  else
    delete from public.tapact_duel_rule_items where version_id = ver;
  end if;

  set constraints tapact_duel_activities_sort_unique deferred;

  for item in select value as spec from jsonb_array_elements(payload -> 'activities')
  loop
    v_activity_name := btrim(item.spec ->> 'name');
    v_target_minutes := (item.spec ->> 'targetMinutes')::int;
    raw_id := nullif(btrim(coalesce(item.spec ->> 'id', '')), '');
    if raw_id is not null then
      act_id := raw_id::uuid;
      update public.tapact_duel_activities
      set name = v_activity_name, target_minutes = v_target_minutes, sort_order = idx
      where id = act_id and duel_id = p_duel;
    else
      insert into public.tapact_duel_activities (duel_id, name, target_minutes, sort_order)
      values (p_duel, v_activity_name, v_target_minutes, idx)
      returning id into act_id;
    end if;
    insert into public.tapact_duel_rule_items (version_id, activity_id, name, target_minutes, sort_order)
    values (ver, act_id, v_activity_name, v_target_minutes, idx);
    kept := kept || act_id;
    idx := idx + 1;
  end loop;

  delete from public.tapact_duel_activities
  where duel_id = p_duel and not (id = any(kept));

  return ver_no;
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

  -- Validate by installing nothing: reuse the same checks as approval.
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
        'targetMinutes', (item.spec ->> 'targetMinutes')::int
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
  update public.tapact_duel_proposals
  set status = 'approved', effective_on = effective, resolved_at = now()
  where id = prop.id;
  update public.tapact_duels set updated_at = now() where id = d.id;
  return jsonb_build_object('effectiveOn', effective);
end;
$$;

create or replace function public.tapact_reject_duel_proposal(p_proposal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prop public.tapact_duel_proposals%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into prop from public.tapact_duel_proposals where id = p_proposal for update;
  if prop.id is null or prop.status <> 'pending' then
    raise exception 'This change was already resolved.';
  end if;
  if prop.proposer_id = uid then
    raise exception 'The other player has to approve this change.';
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = prop.duel_id and user_id = uid and status = 'active'
  ) then
    raise exception 'You are not in this duel.';
  end if;
  update public.tapact_duel_proposals set status = 'rejected', resolved_at = now() where id = prop.id;
end;
$$;

create or replace function public.tapact_withdraw_duel_proposal(p_proposal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prop public.tapact_duel_proposals%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into prop from public.tapact_duel_proposals where id = p_proposal for update;
  if prop.id is null or prop.status <> 'pending' then
    raise exception 'This change was already resolved.';
  end if;
  if prop.proposer_id is distinct from uid then
    raise exception 'Only the person who proposed this change can withdraw it.';
  end if;
  update public.tapact_duel_proposals set status = 'withdrawn', resolved_at = now() where id = prop.id;
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
    if friend.share_live and not me.muted then
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

alter table public.tapact_duel_rule_versions enable row level security;
alter table public.tapact_duel_rule_items enable row level security;
alter table public.tapact_duel_proposals enable row level security;
alter table public.tapact_duel_rule_versions force row level security;
alter table public.tapact_duel_rule_items force row level security;
alter table public.tapact_duel_proposals force row level security;

revoke all on public.tapact_duel_rule_versions from anon, authenticated;
revoke all on public.tapact_duel_rule_items from anon, authenticated;
revoke all on public.tapact_duel_proposals from anon, authenticated;

revoke all on function public.tapact_duel_sync_pending_rules() from public, anon, authenticated;
revoke all on function public.tapact_duel_next_rule_day(uuid) from public, anon, authenticated;
revoke all on function public.tapact_duel_install_rules(uuid, jsonb, date) from public, anon, authenticated;
revoke all on function public.tapact_duel_member_score(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tapact_propose_duel_rules(uuid, jsonb) from public, anon;
revoke all on function public.tapact_approve_duel_proposal(uuid) from public, anon;
revoke all on function public.tapact_reject_duel_proposal(uuid) from public, anon;
revoke all on function public.tapact_withdraw_duel_proposal(uuid) from public, anon;
revoke all on function public.tapact_duel_board(uuid) from public, anon;

grant execute on function public.tapact_propose_duel_rules(uuid, jsonb) to authenticated;
grant execute on function public.tapact_approve_duel_proposal(uuid) to authenticated;
grant execute on function public.tapact_reject_duel_proposal(uuid) to authenticated;
grant execute on function public.tapact_withdraw_duel_proposal(uuid) to authenticated;
grant execute on function public.tapact_duel_board(uuid) to authenticated;

commit;
