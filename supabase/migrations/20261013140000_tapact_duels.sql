-- TapAct Phase 8A: private 1v1 consistency duels.
--
-- Scoring is computed here from tapact_time_entries. Clients never submit points.
-- Only timer sessions count (source is null or 'timer', and deleted_at_ms is null).
-- Manual Time Rescue entries are editable history, not verified effort, so they do
-- not score. Editing a timer session tombstones it and replaces it with a manual
-- entry, which drops that time out of the duel.
-- Each member's days use the IANA time zone stored when they joined. Changing the
-- device time zone later does not move those days. Nothing before starts_on counts.
-- Overlapping timer intervals for the same activity are merged before scoring.
-- Invite tokens are stored only as SHA-256 hashes. Accept/revoke/leave run as
-- security definer functions so membership limits can't be bypassed from the client.

begin;

create table if not exists public.tapact_duels (
  id uuid primary key default extensions.gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 48),
  duration_days integer not null check (duration_days in (7, 14, 30)),
  starts_on date not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tapact_duel_activities (
  id uuid primary key default extensions.gen_random_uuid(),
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 36),
  target_minutes integer not null check (target_minutes between 5 and 240),
  sort_order integer not null check (sort_order between 0 and 2),
  unique (duel_id, sort_order)
);

create table if not exists public.tapact_duel_members (
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  status text not null default 'active' check (status in ('active', 'left')),
  share_live boolean not null default false,
  muted boolean not null default false,
  left_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);

create table if not exists public.tapact_duel_mappings (
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  user_id uuid not null,
  challenge_activity_id uuid not null references public.tapact_duel_activities (id) on delete cascade,
  tracker_activity_id text not null check (char_length(tracker_activity_id) between 1 and 120),
  primary key (duel_id, user_id, challenge_activity_id),
  foreign key (duel_id, user_id) references public.tapact_duel_members (duel_id, user_id) on delete cascade
);

create table if not exists public.tapact_duel_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tapact_duel_presence (
  duel_id uuid not null,
  user_id uuid not null,
  challenge_activity_id uuid not null references public.tapact_duel_activities (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (duel_id, user_id),
  foreign key (duel_id, user_id) references public.tapact_duel_members (duel_id, user_id) on delete cascade
);

create index if not exists tapact_duel_members_user_idx on public.tapact_duel_members (user_id);
create index if not exists tapact_duel_invites_duel_idx on public.tapact_duel_invites (duel_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.tapact_duel_display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when cleaned is null or position('@' in cleaned) > 0 then 'Player'
    else left(cleaned, 40)
  end
  from (
    select nullif(btrim(coalesce(
      u.raw_user_meta_data ->> 'display_name',
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )), '') as cleaned
    from auth.users u
    where u.id = uid
  ) names;
$$;

create or replace function public.tapact_duel_zone_ok(zone text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if zone is null or zone !~ '^[A-Za-z0-9_+\-/]{1,64}$' then
    return false;
  end if;
  perform now() at time zone zone;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.tapact_duel_token_hash(token text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(token, 'utf8'), 'sha256'), 'hex');
$$;

create or replace function public.tapact_duel_is_member(duel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tapact_duel_members m
    where m.duel_id = duel and m.user_id = (select auth.uid())
  );
$$;

-- Timer minutes per agreed calendar day, in the member's frozen time zone.
create or replace function public.tapact_duel_timer_minutes(
  p_user uuid,
  p_tracker_activity text,
  p_zone text,
  p_start date,
  p_until date,
  p_left timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  window_start timestamptz := p_start::timestamp at time zone p_zone;
  window_end timestamptz := p_until::timestamp at time zone p_zone;
  merged_s timestamptz[] := '{}';
  merged_e timestamptz[] := '{}';
  rec record;
  s timestamptz;
  e timestamptz;
  n int;
  i int;
  cursor_ts timestamptz;
  local_ts timestamp;
  nxt timestamptz;
  boundary timestamptz;
  day date;
  totals jsonb := '{}'::jsonb;
  add_ms bigint;
  prev bigint;
begin
  if p_left is not null and p_left < window_end then
    window_end := p_left;
  end if;
  if window_end <= window_start or p_tracker_activity is null then
    return totals;
  end if;

  for rec in
    select started_at_ms, ended_at_ms
    from public.tapact_time_entries
    where user_id = p_user
      and activity_id = p_tracker_activity
      and deleted_at_ms is null
      and coalesce(source, 'timer') = 'timer'
      and ended_at_ms > started_at_ms
    order by started_at_ms, ended_at_ms
  loop
    s := to_timestamp(rec.started_at_ms / 1000.0);
    e := to_timestamp(rec.ended_at_ms / 1000.0);
    if e <= window_start or s >= window_end then
      continue;
    end if;
    s := greatest(s, window_start);
    e := least(e, window_end);
    if e <= s then
      continue;
    end if;
    n := coalesce(array_length(merged_s, 1), 0);
    if n > 0 and s <= merged_e[n] then
      merged_e[n] := greatest(merged_e[n], e);
    else
      merged_s := merged_s || s;
      merged_e := merged_e || e;
    end if;
  end loop;

  n := coalesce(array_length(merged_s, 1), 0);
  for i in 1..n loop
    cursor_ts := merged_s[i];
    while cursor_ts < merged_e[i] loop
      local_ts := cursor_ts at time zone p_zone;
      day := local_ts::date;
      nxt := (date_trunc('day', local_ts) + interval '1 day') at time zone p_zone;
      if nxt <= cursor_ts then
        nxt := cursor_ts + interval '1 second';
      end if;
      boundary := least(merged_e[i], nxt);
      if day >= p_start and day < p_until then
        add_ms := floor(extract(epoch from (boundary - cursor_ts)) * 1000);
        prev := coalesce((totals ->> day::text)::bigint, 0);
        totals := jsonb_set(totals, array[day::text], to_jsonb(prev + add_ms), true);
      end if;
      cursor_ts := boundary;
    end loop;
  end loop;
  return totals;
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
  totals jsonb;
  tracked int;
  met boolean;
  met_count int;
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
    for act in
      select a.id, a.target_minutes, map.tracker_activity_id
      from public.tapact_duel_activities a
      left join public.tapact_duel_mappings map
        on map.challenge_activity_id = a.id and map.user_id = p_user and map.duel_id = p_duel
      where a.duel_id = p_duel
      order by a.sort_order
    loop
      totals := public.tapact_duel_timer_minutes(
        p_user, act.tracker_activity_id, m.time_zone, d.starts_on, d.starts_on + d.duration_days, m.left_at
      );
      tracked := floor(coalesce((totals ->> day::text)::bigint, 0) / 60000.0);
      target := act.target_minutes;
      met := act.tracker_activity_id is not null and tracked >= target;
      if met then
        met_count := met_count + 1;
      end if;
      activities := activities || jsonb_build_array(jsonb_build_object(
        'id', act.id, 'minutes', tracked, 'met', met
      ));
    end loop;
    bonus := met_count > 0 and met_count = (select count(*) from public.tapact_duel_activities where duel_id = p_duel);
    day_points := met_count * 20 + case when bonus then 10 else 0 end;
    points := points + day_points;
    days := days || jsonb_build_array(jsonb_build_object(
      'dayKey', day, 'points', day_points, 'bonus', bonus, 'activities', activities
    ));
  end loop;
  return jsonb_build_object('points', points, 'days', days);
end;
$$;

-- ---------------------------------------------------------------------------
-- Mutations
-- ---------------------------------------------------------------------------

create or replace function public.tapact_create_duel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  zone text := payload ->> 'timeZone';
  title text := btrim(coalesce(payload ->> 'title', ''));
  duration int := (payload ->> 'durationDays')::int;
  starts date := (payload ->> 'startsOn')::date;
  today date;
  duel uuid;
  token text;
  act record;
  idx int := 0;
  act_id uuid;
  tracker text;
  name text;
  target int;
begin
  if uid is null then
    raise exception 'Sign in to create a duel.';
  end if;
  if not public.tapact_duel_zone_ok(zone) then
    raise exception 'Choose a valid time zone.';
  end if;
  today := (now() at time zone zone)::date;
  if duration not in (7, 14, 30) then
    raise exception 'Choose a 7, 14, or 30 day duel.';
  end if;
  if starts is null or starts < today or starts > today + 14 then
    raise exception 'The start date has to be today or within two weeks.';
  end if;
  if char_length(title) < 2 or char_length(title) > 48 then
    raise exception 'Give the duel a title (2–48 characters).';
  end if;
  if jsonb_typeof(payload -> 'activities') <> 'array'
     or jsonb_array_length(payload -> 'activities') < 1
     or jsonb_array_length(payload -> 'activities') > 3 then
    raise exception 'Choose 1 to 3 activities.';
  end if;
  if (
    select count(*) from public.tapact_duel_members mem
    join public.tapact_duels d on d.id = mem.duel_id
    where mem.user_id = uid and mem.status = 'active' and d.status in ('pending', 'active')
  ) >= 20 then
    raise exception 'You already have 20 open duels.';
  end if;

  insert into public.tapact_duels (creator_id, title, duration_days, starts_on)
  values (uid, title, duration, starts)
  returning id into duel;

  insert into public.tapact_duel_members (duel_id, user_id, display_name, time_zone)
  values (duel, uid, public.tapact_duel_display_name(uid), zone);

  for act in select value as item from jsonb_array_elements(payload -> 'activities')
  loop
    name := btrim(coalesce(act.item ->> 'name', ''));
    target := (act.item ->> 'targetMinutes')::int;
    tracker := nullif(btrim(coalesce(act.item ->> 'trackerActivityId', '')), '');
    if char_length(name) < 2 or char_length(name) > 36 or target < 5 or target > 240 then
      raise exception 'Each activity needs a name and a target of 5–240 minutes.';
    end if;
    insert into public.tapact_duel_activities (duel_id, name, target_minutes, sort_order)
    values (duel, name, target, idx)
    returning id into act_id;
    if tracker is not null then
      insert into public.tapact_duel_mappings (duel_id, user_id, challenge_activity_id, tracker_activity_id)
      values (duel, uid, act_id, left(tracker, 120));
    end if;
    idx := idx + 1;
  end loop;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tapact_duel_invites (duel_id, token_hash, expires_at)
  values (duel, public.tapact_duel_token_hash(token), now() + interval '7 days');

  return jsonb_build_object('duelId', duel, 'token', token);
end;
$$;

create or replace function public.tapact_preview_duel_invite(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.tapact_duel_invites%rowtype;
  d public.tapact_duels%rowtype;
  creator_name text;
  state text;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into inv from public.tapact_duel_invites where token_hash = public.tapact_duel_token_hash(token);
  if inv.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into d from public.tapact_duels where id = inv.duel_id;
  if inv.revoked_at is not null or d.status = 'cancelled' then
    state := 'revoked';
  elsif inv.accepted_at is not null or d.status in ('active', 'completed') then
    state := 'used';
  elsif inv.expires_at <= now() then
    state := 'expired';
  else
    state := 'open';
  end if;
  select display_name into creator_name
  from public.tapact_duel_members
  where duel_id = d.id and user_id = d.creator_id;

  return jsonb_build_object(
    'state', state,
    'title', d.title,
    'durationDays', d.duration_days,
    'startsOn', d.starts_on,
    'inviter', creator_name,
    'creator', auth.uid() = d.creator_id,
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'targetMinutes', a.target_minutes) order by a.sort_order)
      from public.tapact_duel_activities a where a.duel_id = d.id
    ), '[]'::jsonb),
    'rules', jsonb_build_array(
      '20 points for each daily target you meet.',
      '10 bonus points when every target is met that day.',
      'Time past a target does not add points.',
      'Only timer-recorded time counts. Sessions added or edited by hand stay in History and do not score.',
      'Days use the time zone saved when you join, even if your phone time zone changes later.',
      'Nothing before the start date counts.'
    )
  );
end;
$$;

create or replace function public.tapact_accept_duel_invite(token text, zone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.tapact_duel_invites%rowtype;
  d public.tapact_duels%rowtype;
  members int;
begin
  if uid is null then
    raise exception 'Sign in to respond to this invite.';
  end if;
  if token is null or token !~ '^[0-9a-f]{64}$' then
    raise exception 'This invite link is not valid.';
  end if;
  if not public.tapact_duel_zone_ok(zone) then
    raise exception 'Choose a valid time zone.';
  end if;

  select * into inv from public.tapact_duel_invites where token_hash = public.tapact_duel_token_hash(token);
  if inv.id is null then
    raise exception 'This invite link is not valid.';
  end if;

  select * into d from public.tapact_duels where id = inv.duel_id for update;
  select * into inv from public.tapact_duel_invites where id = inv.id for update;
  select count(*) into members from public.tapact_duel_members where duel_id = d.id;

  if uid = d.creator_id then
    raise exception 'You can''t accept your own invite.';
  end if;
  if inv.revoked_at is not null or d.status = 'cancelled' then
    raise exception 'This invite was revoked.';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invite has already been used.';
  end if;
  if inv.expires_at <= now() then
    raise exception 'This invite has expired.';
  end if;
  if members >= 2 then
    raise exception 'This duel already has two people.';
  end if;
  if (now() at time zone zone)::date >= d.starts_on + d.duration_days then
    raise exception 'This duel has already ended.';
  end if;

  insert into public.tapact_duel_members (duel_id, user_id, display_name, time_zone)
  values (d.id, uid, public.tapact_duel_display_name(uid), zone);

  update public.tapact_duel_invites
  set accepted_by = uid, accepted_at = now()
  where id = inv.id;

  update public.tapact_duels
  set status = 'active', updated_at = now()
  where id = d.id;

  return jsonb_build_object('duelId', d.id);
end;
$$;

create or replace function public.tapact_decline_duel_invite(token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.tapact_duel_invites%rowtype;
  d public.tapact_duels%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to respond to this invite.';
  end if;
  select * into inv from public.tapact_duel_invites where token_hash = public.tapact_duel_token_hash(token);
  if inv.id is null then
    raise exception 'This invite link is not valid.';
  end if;
  select * into d from public.tapact_duels where id = inv.duel_id for update;
  if uid = d.creator_id then
    raise exception 'Revoke the invite from Duels instead.';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invite has already been used.';
  end if;
  update public.tapact_duel_invites set revoked_at = coalesce(revoked_at, now()) where id = inv.id;
  update public.tapact_duels set status = 'cancelled', updated_at = now() where id = d.id and status = 'pending';
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
  if d.creator_id is distinct from uid or d.status <> 'pending' then
    raise exception 'Only an open invite can be revoked.';
  end if;
  update public.tapact_duel_invites set revoked_at = coalesce(revoked_at, now()) where duel_id = p_duel and accepted_at is null;
  update public.tapact_duels set status = 'cancelled', updated_at = now() where id = p_duel;
end;
$$;

create or replace function public.tapact_reissue_duel_invite(p_duel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
  token text;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel for update;
  if d.creator_id is distinct from uid or d.status <> 'pending' then
    raise exception 'Only an open invite can be replaced.';
  end if;
  update public.tapact_duel_invites set revoked_at = coalesce(revoked_at, now()) where duel_id = p_duel and accepted_at is null;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tapact_duel_invites (duel_id, token_hash, expires_at)
  values (p_duel, public.tapact_duel_token_hash(token), now() + interval '7 days');
  return jsonb_build_object('token', token);
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
  if d.status not in ('pending', 'active') then
    raise exception 'This duel is already finished.';
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

create or replace function public.tapact_set_duel_prefs(p_duel uuid, p_share boolean, p_muted boolean)
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
  set share_live = coalesce(p_share, false), muted = coalesce(p_muted, false)
  where duel_id = p_duel and user_id = uid and status = 'active';
  if not found then
    raise exception 'You are not in this duel.';
  end if;
  if coalesce(p_share, false) = false then
    delete from public.tapact_duel_presence where duel_id = p_duel and user_id = uid;
  end if;
end;
$$;

create or replace function public.tapact_set_duel_presence(p_duel uuid, p_activity uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  if not exists (
    select 1 from public.tapact_duel_members
    where duel_id = p_duel and user_id = uid and status = 'active' and share_live
  ) then
    delete from public.tapact_duel_presence where duel_id = p_duel and user_id = uid;
    return;
  end if;
  if not exists (
    select 1 from public.tapact_duel_activities where id = p_activity and duel_id = p_duel
  ) then
    return;
  end if;
  insert into public.tapact_duel_presence (duel_id, user_id, challenge_activity_id, updated_at)
  values (p_duel, uid, p_activity, now())
  on conflict (duel_id, user_id) do update
  set challenge_activity_id = excluded.challenge_activity_id, updated_at = now();
end;
$$;

create or replace function public.tapact_clear_duel_presence(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.tapact_duel_presence where duel_id = p_duel and user_id = auth.uid();
end;
$$;

create or replace function public.tapact_map_duel_activity(p_duel uuid, p_activity uuid, p_tracker text)
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
  if not exists (
    select 1 from public.tapact_duel_members where duel_id = p_duel and user_id = uid and status = 'active'
  ) then
    raise exception 'You are not in this duel.';
  end if;
  if not exists (
    select 1 from public.tapact_duel_activities where id = p_activity and duel_id = p_duel
  ) then
    raise exception 'That activity is not part of this duel.';
  end if;
  if p_tracker is null or char_length(btrim(p_tracker)) < 1 then
    delete from public.tapact_duel_mappings
    where duel_id = p_duel and user_id = uid and challenge_activity_id = p_activity;
    return;
  end if;
  insert into public.tapact_duel_mappings (duel_id, user_id, challenge_activity_id, tracker_activity_id)
  values (p_duel, uid, p_activity, left(btrim(p_tracker), 120))
  on conflict (duel_id, user_id, challenge_activity_id) do update
  set tracker_activity_id = excluded.tracker_activity_id;
end;
$$;

-- One call when the timer starts, stops, or switches. No-op unless live sharing is on.
create or replace function public.tapact_sync_duel_presence(p_tracker text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tracker text := nullif(btrim(coalesce(p_tracker, '')), '');
begin
  if uid is null then
    return;
  end if;
  if tracker is null then
    delete from public.tapact_duel_presence where user_id = uid;
    return;
  end if;
  delete from public.tapact_duel_presence p
  where p.user_id = uid
    and not exists (
      select 1
      from public.tapact_duel_mappings map
      join public.tapact_duel_members m
        on m.duel_id = map.duel_id and m.user_id = uid and m.status = 'active' and m.share_live
      where map.tracker_activity_id = tracker
        and map.duel_id = p.duel_id
        and map.challenge_activity_id = p.challenge_activity_id
    );
  insert into public.tapact_duel_presence (duel_id, user_id, challenge_activity_id, updated_at)
  select distinct on (map.duel_id) map.duel_id, uid, map.challenge_activity_id, now()
  from public.tapact_duel_mappings map
  join public.tapact_duel_members m
    on m.duel_id = map.duel_id and m.user_id = uid and m.status = 'active' and m.share_live
  where map.tracker_activity_id = tracker
  order by map.duel_id, map.challenge_activity_id
  on conflict (duel_id, user_id) do update
  set challenge_activity_id = excluded.challenge_activity_id, updated_at = now();
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

  return jsonb_build_object(
    'duel', jsonb_build_object(
      'id', d.id, 'title', d.title, 'durationDays', d.duration_days, 'startsOn', d.starts_on,
      'status', d.status, 'final', final, 'winner', winner, 'awaitingOpponent', friend.user_id is null and d.status = 'pending'
    ),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'targetMinutes', a.target_minutes) order by a.sort_order)
      from public.tapact_duel_activities a where a.duel_id = p_duel
    ), '[]'::jsonb),
    'you', jsonb_build_object(
      'name', me.display_name, 'score', coalesce((you_score ->> 'points')::int, 0),
      'status', me.status, 'shareLive', me.share_live, 'muted', me.muted,
      'todayKey', (now() at time zone me.time_zone)::date,
      'mappings', coalesce((
        select jsonb_agg(jsonb_build_object('challengeActivityId', map.challenge_activity_id, 'trackerActivityId', map.tracker_activity_id))
        from public.tapact_duel_mappings map where map.duel_id = p_duel and map.user_id = uid
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
    select jsonb_agg(item order by item ->> 'startsOn' desc)
    from (
      select jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'status', d.status,
        'startsOn', d.starts_on,
        'durationDays', d.duration_days,
        'awaitingOpponent', d.status = 'pending'
      ) as item
      from public.tapact_duels d
      join public.tapact_duel_members m on m.duel_id = d.id and m.user_id = uid
      where d.status <> 'cancelled'
    ) rows
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security. Mutations go through the functions above.
-- ---------------------------------------------------------------------------

alter table public.tapact_duels enable row level security;
alter table public.tapact_duel_activities enable row level security;
alter table public.tapact_duel_members enable row level security;
alter table public.tapact_duel_mappings enable row level security;
alter table public.tapact_duel_invites enable row level security;
alter table public.tapact_duel_presence enable row level security;

alter table public.tapact_duels force row level security;
alter table public.tapact_duel_activities force row level security;
alter table public.tapact_duel_members force row level security;
alter table public.tapact_duel_mappings force row level security;
alter table public.tapact_duel_invites force row level security;
alter table public.tapact_duel_presence force row level security;

revoke all on public.tapact_duels from anon, authenticated;
revoke all on public.tapact_duel_activities from anon, authenticated;
revoke all on public.tapact_duel_members from anon, authenticated;
revoke all on public.tapact_duel_mappings from anon, authenticated;
revoke all on public.tapact_duel_invites from anon, authenticated;
revoke all on public.tapact_duel_presence from anon, authenticated;

-- No client table access. Boards and invites come from the functions above, so
-- opponent user ids, emails, and presence timestamps are not selectable.

create policy "Members read duels" on public.tapact_duels
  for select to authenticated using (public.tapact_duel_is_member(id));
create policy "Members read duel activities" on public.tapact_duel_activities
  for select to authenticated using (public.tapact_duel_is_member(duel_id));
create policy "Members read duel roster" on public.tapact_duel_members
  for select to authenticated using (public.tapact_duel_is_member(duel_id));
create policy "Members read shared presence" on public.tapact_duel_presence
  for select to authenticated using (
    public.tapact_duel_is_member(duel_id)
    and (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.tapact_duel_members m
        where m.duel_id = tapact_duel_presence.duel_id
          and m.user_id = tapact_duel_presence.user_id
          and m.share_live
      )
    )
  );

revoke all on function public.tapact_duel_is_member(uuid) from public, anon;
grant execute on function public.tapact_duel_is_member(uuid) to authenticated;
revoke all on function public.tapact_duel_display_name(uuid) from public, anon, authenticated;
revoke all on function public.tapact_duel_zone_ok(text) from public, anon, authenticated;
revoke all on function public.tapact_duel_token_hash(text) from public, anon, authenticated;
revoke all on function public.tapact_duel_timer_minutes(uuid, text, text, date, date, timestamptz) from public, anon, authenticated;
revoke all on function public.tapact_duel_member_score(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tapact_create_duel(jsonb) from public, anon;
revoke all on function public.tapact_preview_duel_invite(text) from public;
revoke all on function public.tapact_accept_duel_invite(text, text) from public, anon;
revoke all on function public.tapact_decline_duel_invite(text) from public, anon;
revoke all on function public.tapact_revoke_duel_invite(uuid) from public, anon;
revoke all on function public.tapact_reissue_duel_invite(uuid) from public, anon;
revoke all on function public.tapact_leave_duel(uuid) from public, anon;
revoke all on function public.tapact_set_duel_prefs(uuid, boolean, boolean) from public, anon;
revoke all on function public.tapact_set_duel_presence(uuid, uuid) from public, anon;
revoke all on function public.tapact_clear_duel_presence(uuid) from public, anon;
revoke all on function public.tapact_map_duel_activity(uuid, uuid, text) from public, anon;
revoke all on function public.tapact_sync_duel_presence(text) from public, anon;
revoke all on function public.tapact_duel_board(uuid) from public, anon;
revoke all on function public.tapact_list_duels() from public, anon;

grant execute on function public.tapact_create_duel(jsonb) to authenticated;
grant execute on function public.tapact_preview_duel_invite(text) to anon, authenticated;
grant execute on function public.tapact_accept_duel_invite(text, text) to authenticated;
grant execute on function public.tapact_decline_duel_invite(text) to authenticated;
grant execute on function public.tapact_revoke_duel_invite(uuid) to authenticated;
grant execute on function public.tapact_reissue_duel_invite(uuid) to authenticated;
grant execute on function public.tapact_leave_duel(uuid) to authenticated;
grant execute on function public.tapact_set_duel_prefs(uuid, boolean, boolean) to authenticated;
grant execute on function public.tapact_set_duel_presence(uuid, uuid) to authenticated;
grant execute on function public.tapact_clear_duel_presence(uuid) to authenticated;
grant execute on function public.tapact_map_duel_activity(uuid, uuid, text) to authenticated;
grant execute on function public.tapact_sync_duel_presence(text) to authenticated;
grant execute on function public.tapact_duel_board(uuid) to authenticated;
grant execute on function public.tapact_list_duels() to authenticated;

commit;
