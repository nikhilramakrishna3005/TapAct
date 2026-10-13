-- TapAct Phase 8A.1: the creator may revise shared activities while the invite is pending.
-- The whole change commits together or not at all. After acceptance the list is locked.
-- This does not change scoring, start dates, or existing rows.

begin;

-- Replace only UNIQUE (duel_id, sort_order) so a reorder can commit in one transaction.
-- Primary keys, foreign keys, checks, and any other unique constraint stay in place.
do $$
declare
  cname text;
begin
  select con.conname into strict cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'tapact_duel_activities'
    and con.contype = 'u'
    and (
      select array_agg(att.attname::text order by att.attname)
      from unnest(con.conkey) with ordinality as cols(attnum, ord)
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum = cols.attnum
       and not att.attisdropped
    ) = array['duel_id', 'sort_order']::text[];

  execute format('alter table public.tapact_duel_activities drop constraint %I', cname);
exception
  when no_data_found or too_many_rows then
    raise exception 'Expected exactly one unique (duel_id, sort_order) on tapact_duel_activities.';
end $$;

alter table public.tapact_duel_activities
  add constraint tapact_duel_activities_sort_unique
  unique (duel_id, sort_order) deferrable initially deferred;

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

  set constraints tapact_duel_activities_sort_unique deferred;

  for item in select value as spec from jsonb_array_elements(payload -> 'activities')
  loop
    v_activity_name := btrim(item.spec ->> 'name');
    v_target_minutes := (item.spec ->> 'targetMinutes')::int;
    raw_id := nullif(btrim(coalesce(item.spec ->> 'id', '')), '');
    if raw_id is not null then
      act_id := raw_id::uuid;
      update public.tapact_duel_activities
      set name = v_activity_name, target_minutes = v_target_minutes, sort_order = v_sort_order
      where id = act_id and duel_id = p_duel;
    else
      insert into public.tapact_duel_activities (duel_id, name, target_minutes, sort_order)
      values (p_duel, v_activity_name, v_target_minutes, v_sort_order)
      returning id into act_id;
    end if;
    kept := kept || act_id;
    v_sort_order := v_sort_order + 1;
  end loop;

  delete from public.tapact_duel_activities
  where duel_id = p_duel and not (id = any(kept));

  update public.tapact_duels set updated_at = now() where id = p_duel;
end;
$$;

revoke all on function public.tapact_set_duel_rules(uuid, jsonb) from public, anon;
grant execute on function public.tapact_set_duel_rules(uuid, jsonb) to authenticated;

commit;
