-- TapAct Phase 7B: Time Rescue (editing, adding and deleting sessions).
--
-- Sessions keep their grow-only identity. A correction never rewrites a row; it marks
-- the original as deleted and adds a new row with source = 'manual':
--
--   source         'timer' for recorded timer segments, 'manual' for sessions entered
--                  or corrected by hand. Immutable once written.
--   deleted_at_ms  Set when the session was deleted or replaced by an edit. Sticky: the
--                  earliest deletion wins and it can never be cleared, so a stale upload
--                  from another device (or a timer still extending the segment) can't
--                  bring a deleted session back.
--
-- Additive only: existing rows become source = 'timer', deleted_at_ms = null, and
-- clients that don't send the new columns keep working. Row Level Security is unchanged.

begin;

alter table public.tapact_time_entries
  add column if not exists source text not null default 'timer',
  add column if not exists deleted_at_ms bigint;

alter table public.tapact_time_entries drop constraint if exists tapact_time_entries_source_check;
alter table public.tapact_time_entries
  add constraint tapact_time_entries_source_check check (source in ('timer', 'manual'));

alter table public.tapact_time_entries drop constraint if exists tapact_time_entries_deleted_check;
alter table public.tapact_time_entries
  add constraint tapact_time_entries_deleted_check check (deleted_at_ms is null or deleted_at_ms >= 0);

create or replace function public.tapact_time_entries_merge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.source := coalesce(new.source, 'timer');
  end if;
  if tg_op = 'UPDATE' then
    -- Identity of a segment is immutable; it can only grow.
    new.user_id := old.user_id;
    new.id := old.id;
    new.activity_id := old.activity_id;
    new.device_id := old.device_id;
    new.started_at_ms := old.started_at_ms;
    new.created_at := old.created_at;
    new.source := old.source;
    new.ended_at_ms := greatest(old.ended_at_ms, new.ended_at_ms);
    -- Deletion is sticky: the earliest deletion wins and never reverts.
    new.deleted_at_ms := case
      when old.deleted_at_ms is null then new.deleted_at_ms
      when new.deleted_at_ms is null then old.deleted_at_ms
      else least(old.deleted_at_ms, new.deleted_at_ms)
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

commit;
