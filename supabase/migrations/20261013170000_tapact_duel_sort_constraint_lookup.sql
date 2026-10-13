-- TapAct: approval and pending rule edits were failing with
-- constraint "tapact_duel_activities_sort_unique" does not exist.
-- Those functions run with an empty search_path, so an unqualified
-- SET CONSTRAINTS cannot see the public constraint.
-- The constraint is already DEFERRABLE INITIALLY DEFERRED, so the statement
-- is unnecessary. This replaces the two functions and leaves the constraint,
-- grants, RLS, mappings, scoring, and stored rows as they are.

begin;

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

commit;
