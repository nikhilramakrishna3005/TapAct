-- Phase 9B: expose each member's frozen time zone on the existing duel board.
-- A competition day is final only after it has ended in both saved zones.
-- This does not change scoring, rule versions, or notifications.

begin;

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
      'timeZone', me.time_zone,
      'character', public.tapact_duel_public_character(uid),
      'mappings', coalesce((
        select jsonb_agg(jsonb_build_object('challengeActivityId', map.challenge_activity_id, 'trackerActivityId', map.tracker_activity_id))
        from public.tapact_duel_mappings map
        where map.duel_id = p_duel and map.user_id = uid
      ), '[]'::jsonb)
    ),
    'friend', case when friend.user_id is null then null else jsonb_build_object(
      'name', friend.display_name, 'score', coalesce((friend_score ->> 'points')::int, 0), 'status', friend.status,
      'timeZone', friend.time_zone,
      'character', public.tapact_duel_public_character(friend.user_id)
    ) end,
    'youDays', you_score -> 'days',
    'friendDays', case when friend.user_id is null then '[]'::jsonb else friend_score -> 'days' end,
    'presence', presence
  );
end;
$$;

revoke all on function public.tapact_duel_board(uuid) from public, anon;
grant execute on function public.tapact_duel_board(uuid) to authenticated;

commit;
