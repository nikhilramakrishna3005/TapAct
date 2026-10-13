-- TapAct Phase 7C: Life Balance.
--
-- Adds an optional life category to activities. NULL means "Unassigned"; existing
-- activities stay unassigned (nothing is categorized automatically). The category is
-- part of an activity's settings, so it follows the same last-writer-wins rule as the
-- other fields. Additive only; Row Level Security is unchanged.

begin;

alter table public.tapact_activities
  add column if not exists category text;

alter table public.tapact_activities drop constraint if exists tapact_activities_category_check;
alter table public.tapact_activities
  add constraint tapact_activities_category_check
  check (category is null or category in ('work', 'health', 'learning', 'relationships', 'rest'));

create or replace function public.tapact_activities_merge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
    if (new.client_updated_at_ms, new.updated_by_device) < (old.client_updated_at_ms, old.updated_by_device) then
      -- Incoming edit is older: keep the stored fields.
      new.name := old.name;
      new.icon_key := old.icon_key;
      new.color := old.color;
      new.goal_minutes := old.goal_minutes;
      new.cue := old.cue;
      new.category := old.category;
      new.client_updated_at_ms := old.client_updated_at_ms;
      new.updated_by_device := old.updated_by_device;
    end if;
    -- Archiving is sticky: the earliest archive time wins and never reverts.
    new.archived_at_ms := case
      when old.archived_at_ms is null then new.archived_at_ms
      when new.archived_at_ms is null then old.archived_at_ms
      else least(old.archived_at_ms, new.archived_at_ms)
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

commit;
