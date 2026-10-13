-- TapAct Phase 8B: cosmetic Duel character identity, stored per authenticated user.
-- Characters never change scoring, goals, permissions, or historical results.
-- Opponent reads return only the public identity needed for a shared duel board.

begin;

create table if not exists public.tapact_duel_characters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  archetype text not null,
  appearance text not null,
  accent text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tapact_duel_characters_archetype_chk check (archetype in ('scholar', 'warrior', 'strategist')),
  constraint tapact_duel_characters_accent_chk check (accent in ('volt', 'teal', 'cyan', 'ember', 'mint')),
  constraint tapact_duel_characters_title_chk check (title in ('Challenger', 'Focused', 'Consistent', 'Rival', 'Contender', 'Pioneer')),
  constraint tapact_duel_characters_combo_chk check (
    (archetype = 'scholar' and appearance in ('aurora', 'dusk', 'prism'))
    or (archetype = 'warrior' and appearance in ('surge', 'forge', 'tide'))
    or (archetype = 'strategist' and appearance in ('pulse', 'vault', 'signal'))
  )
);

alter table public.tapact_duel_characters enable row level security;
alter table public.tapact_duel_characters force row level security;
revoke all on public.tapact_duel_characters from anon, authenticated;

create or replace function public.tapact_duel_public_character(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'archetype', c.archetype,
    'appearance', c.appearance,
    'accent', c.accent,
    'title', c.title
  )
  from public.tapact_duel_characters c
  where c.user_id = p_user;
$$;

create or replace function public.tapact_get_duel_character()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to view your character.';
  end if;
  return public.tapact_duel_public_character(uid);
end;
$$;

create or replace function public.tapact_set_duel_character(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_archetype text := nullif(trim(coalesce(payload ->> 'archetype', '')), '');
  v_appearance text := nullif(trim(coalesce(payload ->> 'appearance', '')), '');
  v_accent text := nullif(trim(coalesce(payload ->> 'accent', '')), '');
  v_title text := nullif(trim(coalesce(payload ->> 'title', '')), '');
begin
  if uid is null then
    raise exception 'Sign in to choose a character.';
  end if;
  if not (
    (v_archetype = 'scholar' and v_appearance in ('aurora', 'dusk', 'prism'))
    or (v_archetype = 'warrior' and v_appearance in ('surge', 'forge', 'tide'))
    or (v_archetype = 'strategist' and v_appearance in ('pulse', 'vault', 'signal'))
  ) then
    raise exception 'Choose a TapAct character appearance.';
  end if;
  if v_accent not in ('volt', 'teal', 'cyan', 'ember', 'mint') then
    raise exception 'Choose a character accent color.';
  end if;
  if v_title not in ('Challenger', 'Focused', 'Consistent', 'Rival', 'Contender', 'Pioneer') then
    raise exception 'Choose a display title.';
  end if;

  insert into public.tapact_duel_characters (user_id, archetype, appearance, accent, title)
  values (uid, v_archetype, v_appearance, v_accent, v_title)
  on conflict (user_id) do update
    set archetype = excluded.archetype,
        appearance = excluded.appearance,
        accent = excluded.accent,
        title = excluded.title,
        updated_at = now()
  where public.tapact_duel_characters.user_id = uid;

  return public.tapact_duel_public_character(uid);
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
      'character', public.tapact_duel_public_character(uid),
      'mappings', coalesce((
        select jsonb_agg(jsonb_build_object('challengeActivityId', map.challenge_activity_id, 'trackerActivityId', map.tracker_activity_id))
        from public.tapact_duel_mappings map
        where map.duel_id = p_duel and map.user_id = uid
      ), '[]'::jsonb)
    ),
    'friend', case when friend.user_id is null then null else jsonb_build_object(
      'name', friend.display_name, 'score', coalesce((friend_score ->> 'points')::int, 0), 'status', friend.status,
      'character', public.tapact_duel_public_character(friend.user_id)
    ) end,
    'youDays', you_score -> 'days',
    'friendDays', case when friend.user_id is null then '[]'::jsonb else friend_score -> 'days' end,
    'presence', presence
  );
end;
$$;

revoke all on function public.tapact_duel_public_character(uuid) from public, anon, authenticated;
revoke all on function public.tapact_get_duel_character() from public, anon;
revoke all on function public.tapact_set_duel_character(jsonb) from public, anon;
revoke all on function public.tapact_duel_board(uuid) from public, anon;

grant execute on function public.tapact_get_duel_character() to authenticated;
grant execute on function public.tapact_set_duel_character(jsonb) to authenticated;
grant execute on function public.tapact_duel_board(uuid) to authenticated;

commit;
