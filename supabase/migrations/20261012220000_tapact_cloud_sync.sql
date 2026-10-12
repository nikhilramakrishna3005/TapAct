-- TapAct Phase 6B: offline-first cloud sync.
--
-- Three user-owned tables. Every row is keyed by (user_id, id) where id is a stable,
-- client-generated identifier, so retried or duplicated uploads are idempotent upserts.
--
--   tapact_activities       Activity definitions. Last-writer-wins on client_updated_at_ms
--                           (tie-break: updated_by_device); archiving is sticky.
--   tapact_time_entries     Timer segments recorded after sync was enabled. A segment only
--                           ever grows (ended_at_ms keeps the max), and clients merge
--                           overlapping segments of the same activity so time is never
--                           counted twice.
--   tapact_daily_baselines  Per-day totals imported from pre-sync local history, which has
--                           no interval detail. Immutable once written.
--
-- updated_at is set by the server on every write and drives incremental pulls.
-- Row Level Security restricts every table to its owner (auth.uid()).

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.tapact_activities (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 120),
  name text not null check (char_length(name) between 1 and 36),
  icon_key text not null check (char_length(icon_key) between 1 and 32),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  goal_minutes integer check (goal_minutes is null or goal_minutes between 1 and 1440),
  cue text not null default '' check (char_length(cue) <= 48),
  archived_at_ms bigint check (archived_at_ms is null or archived_at_ms >= 0),
  client_updated_at_ms bigint not null default 0 check (client_updated_at_ms >= 0),
  updated_by_device text not null default '' check (char_length(updated_by_device) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.tapact_time_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 240),
  activity_id text not null,
  device_id text not null check (char_length(device_id) between 1 and 64),
  started_at_ms bigint not null check (started_at_ms > 0),
  ended_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint tapact_time_entries_range check (ended_at_ms >= started_at_ms),
  constraint tapact_time_entries_activity_fk
    foreign key (user_id, activity_id)
    references public.tapact_activities (user_id, id)
    on delete cascade
);

create table if not exists public.tapact_daily_baselines (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 320),
  source_id text not null check (char_length(source_id) between 1 and 160),
  day_key date not null,
  activity_id text not null,
  elapsed_ms bigint not null check (elapsed_ms between 0 and 90000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint tapact_daily_baselines_unique_slot unique (user_id, source_id, day_key, activity_id),
  constraint tapact_daily_baselines_activity_fk
    foreign key (user_id, activity_id)
    references public.tapact_activities (user_id, id)
    on delete cascade
);

-- Incremental pulls use keyset pagination on (updated_at, id) per user.
create index if not exists tapact_activities_user_updated_idx
  on public.tapact_activities (user_id, updated_at, id);
create index if not exists tapact_time_entries_user_updated_idx
  on public.tapact_time_entries (user_id, updated_at, id);
create index if not exists tapact_daily_baselines_user_updated_idx
  on public.tapact_daily_baselines (user_id, updated_at, id);
-- Foreign-key lookups (cascades) by activity.
create index if not exists tapact_time_entries_activity_idx
  on public.tapact_time_entries (user_id, activity_id);
create index if not exists tapact_daily_baselines_activity_idx
  on public.tapact_daily_baselines (user_id, activity_id);

-- ---------------------------------------------------------------------------
-- Merge rules enforced server-side, so a stale or replayed upload can never
-- overwrite newer data regardless of which client sent it.
-- ---------------------------------------------------------------------------

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

create or replace function public.tapact_time_entries_merge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Identity of a segment is immutable; it can only grow.
    new.user_id := old.user_id;
    new.id := old.id;
    new.activity_id := old.activity_id;
    new.device_id := old.device_id;
    new.started_at_ms := old.started_at_ms;
    new.created_at := old.created_at;
    new.ended_at_ms := greatest(old.ended_at_ms, new.ended_at_ms);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.tapact_daily_baselines_merge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Baselines are snapshots of imported history and never change.
    new := old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tapact_activities_merge on public.tapact_activities;
create trigger tapact_activities_merge
  before insert or update on public.tapact_activities
  for each row execute function public.tapact_activities_merge();

drop trigger if exists tapact_time_entries_merge on public.tapact_time_entries;
create trigger tapact_time_entries_merge
  before insert or update on public.tapact_time_entries
  for each row execute function public.tapact_time_entries_merge();

drop trigger if exists tapact_daily_baselines_merge on public.tapact_daily_baselines;
create trigger tapact_daily_baselines_merge
  before insert or update on public.tapact_daily_baselines
  for each row execute function public.tapact_daily_baselines_merge();

-- ---------------------------------------------------------------------------
-- Row Level Security: owners only.
-- ---------------------------------------------------------------------------

alter table public.tapact_activities enable row level security;
alter table public.tapact_time_entries enable row level security;
alter table public.tapact_daily_baselines enable row level security;

alter table public.tapact_activities force row level security;
alter table public.tapact_time_entries force row level security;
alter table public.tapact_daily_baselines force row level security;

revoke all on public.tapact_activities from anon;
revoke all on public.tapact_time_entries from anon;
revoke all on public.tapact_daily_baselines from anon;

grant select, insert, update, delete on public.tapact_activities to authenticated;
grant select, insert, update, delete on public.tapact_time_entries to authenticated;
grant select, insert, update, delete on public.tapact_daily_baselines to authenticated;

drop policy if exists "Owners read activities" on public.tapact_activities;
create policy "Owners read activities" on public.tapact_activities
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Owners insert activities" on public.tapact_activities;
create policy "Owners insert activities" on public.tapact_activities
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Owners update activities" on public.tapact_activities;
create policy "Owners update activities" on public.tapact_activities
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners delete activities" on public.tapact_activities;
create policy "Owners delete activities" on public.tapact_activities
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Owners read time entries" on public.tapact_time_entries;
create policy "Owners read time entries" on public.tapact_time_entries
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Owners insert time entries" on public.tapact_time_entries;
create policy "Owners insert time entries" on public.tapact_time_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Owners update time entries" on public.tapact_time_entries;
create policy "Owners update time entries" on public.tapact_time_entries
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners delete time entries" on public.tapact_time_entries;
create policy "Owners delete time entries" on public.tapact_time_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Owners read baselines" on public.tapact_daily_baselines;
create policy "Owners read baselines" on public.tapact_daily_baselines
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Owners insert baselines" on public.tapact_daily_baselines;
create policy "Owners insert baselines" on public.tapact_daily_baselines
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Owners update baselines" on public.tapact_daily_baselines;
create policy "Owners update baselines" on public.tapact_daily_baselines
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners delete baselines" on public.tapact_daily_baselines;
create policy "Owners delete baselines" on public.tapact_daily_baselines
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
