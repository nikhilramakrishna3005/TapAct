-- TapAct Phase 9A.1: in-app duel notification inbox.
--
-- Rows are created only inside security definer triggers and
-- tapact_reconcile_duel_notifications. Authenticated clients can list and mark
-- their own rows. They cannot insert or edit notification text.
--
-- Immediate events (invite accepted, proposal, approval, rejection, opponent
-- left) are written by triggers on the duel change itself. They do not depend
-- on a browser tab staying open.
--
-- Time-based events (official start, rules becoming effective, duel finished)
-- have no background scheduler in this phase. TapAct does not run a background scheduler
-- for them. A signed-in refresh calls tapact_reconcile_duel_notifications,
-- which is also safe to repeat. Duels that were already completed before this
-- migration are not backfilled.
--
-- Finish uses the same later-of-both-time-zones instant as tapact_duel_board.
-- Official start and rule effectiveness use each member's saved time zone.
-- Nothing here reads timer rows, live presence, or private activity names.

begin;

create table if not exists public.tapact_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in (
    'invite_accepted',
    'duel_started',
    'proposal_received',
    'proposal_approved',
    'proposal_rejected',
    'rules_effective',
    'duel_finished',
    'opponent_left'
  )),
  duel_id uuid not null references public.tapact_duels (id) on delete cascade,
  proposal_id uuid references public.tapact_duel_proposals (id) on delete set null,
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  dedupe_key text not null check (char_length(dedupe_key) between 3 and 160)
);

create unique index if not exists tapact_notifications_recipient_dedupe_uidx
  on public.tapact_notifications (recipient_id, dedupe_key);

create index if not exists tapact_notifications_inbox_idx
  on public.tapact_notifications (recipient_id, created_at desc, id desc);

create index if not exists tapact_notifications_unread_idx
  on public.tapact_notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.tapact_notifications enable row level security;
alter table public.tapact_notifications force row level security;

revoke all on public.tapact_notifications from anon, authenticated;

create policy "Recipients read own notifications"
  on public.tapact_notifications
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

-- Server-only insert. Not granted to clients. Skips non-members and repeats.
create or replace function public.tapact_emit_notification(
  p_recipient uuid,
  p_event text,
  p_duel uuid,
  p_proposal uuid,
  p_title text,
  p_body text,
  p_dedupe text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null or p_duel is null or p_dedupe is null then
    return;
  end if;
  if not exists (
    select 1
    from public.tapact_duel_members m
    where m.duel_id = p_duel and m.user_id = p_recipient
  ) then
    return;
  end if;
  insert into public.tapact_notifications (
    recipient_id, event_type, duel_id, proposal_id, title, body, dedupe_key
  ) values (
    p_recipient,
    p_event,
    p_duel,
    p_proposal,
    left(btrim(p_title), 80),
    left(btrim(p_body), 240),
    left(p_dedupe, 160)
  )
  on conflict (recipient_id, dedupe_key) do nothing;
end;
$$;

create or replace function public.tapact_notify_duel_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepter_name text;
  member_id uuid;
begin
  if old.status = 'pending' and new.status = 'active' and new.creator_id is distinct from auth.uid() then
    select m.display_name into accepter_name
    from public.tapact_duel_members m
    where m.duel_id = new.id and m.user_id is distinct from new.creator_id
    order by m.joined_at desc
    limit 1;
    if accepter_name is not null then
      perform public.tapact_emit_notification(
        new.creator_id,
        'invite_accepted',
        new.id,
        null,
        'Invite accepted',
        accepter_name || ' accepted your duel "' || new.title || '".',
        'invite_accepted:' || new.id::text
      );
    end if;
  end if;

  if old.status = 'active' and new.status = 'completed' then
    for member_id in
      select m.user_id from public.tapact_duel_members m where m.duel_id = new.id
    loop
      perform public.tapact_emit_notification(
        member_id,
        'duel_finished',
        new.id,
        null,
        'Duel finished',
        '"' || new.title || '" is finished. Results are ready.',
        'duel_finished:' || new.id::text
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.tapact_notify_duel_departure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  duel_title text;
  other_id uuid;
begin
  if old.status is distinct from 'active' or new.status is distinct from 'left' then
    return new;
  end if;

  select d.title into duel_title from public.tapact_duels d where d.id = new.duel_id;
  if duel_title is null then
    return new;
  end if;

  for other_id in
    select m.user_id
    from public.tapact_duel_members m
    where m.duel_id = new.duel_id
      and m.user_id <> new.user_id
  loop
    perform public.tapact_emit_notification(
      other_id,
      'opponent_left',
      new.duel_id,
      null,
      'Opponent left',
      new.display_name || ' left "' || duel_title || '".',
      'opponent_left:' || new.duel_id::text || ':' || new.user_id::text
    );
  end loop;

  return new;
end;
$$;

create or replace function public.tapact_notify_duel_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  duel_title text;
  actor_name text;
  other_id uuid;
  effective_label text;
begin
  select d.title into duel_title from public.tapact_duels d where d.id = new.duel_id;
  if duel_title is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    select m.display_name into actor_name
    from public.tapact_duel_members m
    where m.duel_id = new.duel_id and m.user_id = new.proposer_id;
    for other_id in
      select m.user_id
      from public.tapact_duel_members m
      where m.duel_id = new.duel_id
        and m.user_id <> new.proposer_id
        and m.status = 'active'
    loop
      perform public.tapact_emit_notification(
        other_id,
        'proposal_received',
        new.duel_id,
        new.id,
        'Rule change proposed',
        coalesce(actor_name, 'Your opponent') || ' proposed a change to "' || duel_title || '".',
        'proposal_received:' || new.id::text
      );
    end loop;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and new.status in ('approved', 'rejected')
     and new.proposer_id is distinct from auth.uid() then
    select m.display_name into actor_name
    from public.tapact_duel_members m
    where m.duel_id = new.duel_id and m.user_id = auth.uid();
    if new.status = 'approved' then
      effective_label := coalesce(new.effective_on::text, 'the next shared day');
      perform public.tapact_emit_notification(
        new.proposer_id,
        'proposal_approved',
        new.duel_id,
        new.id,
        'Rule change approved',
        coalesce(actor_name, 'Your opponent') || ' approved your changes to "' || duel_title || '". They start on ' || effective_label || '.',
        'proposal_approved:' || new.id::text
      );
    else
      perform public.tapact_emit_notification(
        new.proposer_id,
        'proposal_rejected',
        new.duel_id,
        new.id,
        'Rule change declined',
        coalesce(actor_name, 'Your opponent') || ' declined your changes to "' || duel_title || '".',
        'proposal_rejected:' || new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

-- Called from a signed-in refresh. Idempotent. Does not backfill duels that
-- are already completed, and does not notify anyone who is not a member.
create or replace function public.tapact_reconcile_duel_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  duel_id uuid;
  d public.tapact_duels%rowtype;
  my_zone text;
  friend_zone text;
  later timestamptz;
  member record;
  rule record;
  reader record;
begin
  if uid is null then
    return;
  end if;

  for duel_id in
    select d0.id
    from public.tapact_duels d0
    join public.tapact_duel_members mine
      on mine.duel_id = d0.id and mine.user_id = uid
    where d0.status = 'active'
    order by d0.id
  loop
    select * into d from public.tapact_duels where id = duel_id for update;
    if d.id is null or d.status is distinct from 'active' then
      continue;
    end if;

    select m.time_zone into my_zone
    from public.tapact_duel_members m
    where m.duel_id = d.id and m.user_id = uid;

    for member in
      select m.user_id, m.time_zone
      from public.tapact_duel_members m
      where m.duel_id = d.id
    loop
      if (now() at time zone member.time_zone)::date >= d.starts_on then
        perform public.tapact_emit_notification(
          member.user_id,
          'duel_started',
          d.id,
          null,
          'Duel started',
          '"' || d.title || '" has officially started.',
          'duel_started:' || d.id::text
        );
      end if;
    end loop;

    for rule in
      select p.id, p.effective_on
      from public.tapact_duel_proposals p
      where p.duel_id = d.id
        and p.status = 'approved'
        and p.effective_on is not null
    loop
      for reader in
        select m.user_id, m.time_zone
        from public.tapact_duel_members m
        where m.duel_id = d.id
      loop
        if (now() at time zone reader.time_zone)::date >= rule.effective_on then
          perform public.tapact_emit_notification(
            reader.user_id,
            'rules_effective',
            d.id,
            rule.id,
            'Rules updated',
            'New rules for "' || d.title || '" are in effect.',
            'rules_effective:' || rule.id::text
          );
        end if;
      end loop;
    end loop;

    select f.time_zone into friend_zone
    from public.tapact_duel_members f
    where f.duel_id = d.id and f.user_id <> uid
    limit 1;

    if friend_zone is not null and my_zone is not null then
      later := greatest(
        (d.starts_on + d.duration_days)::timestamp at time zone my_zone,
        (d.starts_on + d.duration_days)::timestamp at time zone friend_zone
      );
      if now() >= later then
        update public.tapact_duels
        set status = 'completed', updated_at = now()
        where id = d.id and status = 'active';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.tapact_list_notifications(
  p_limit integer default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  take integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  unread integer := 0;
  fetched integer := 0;
  items jsonb := '[]'::jsonb;
begin
  if uid is null then
    return jsonb_build_object('unread', 0, 'hasMore', false, 'items', '[]'::jsonb);
  end if;

  select count(*) into unread
  from public.tapact_notifications n
  where n.recipient_id = uid and n.read_at is null;

  select count(*) into fetched
  from (
    select n.id
    from public.tapact_notifications n
    where n.recipient_id = uid
      and (
        p_before is null
        or (n.created_at, n.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
    order by n.created_at desc, n.id desc
    limit (take + 1)
  ) probe;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'eventType', t.event_type,
    'duelId', t.duel_id,
    'proposalId', t.proposal_id,
    'title', t.title,
    'body', t.body,
    'createdAt', t.created_at,
    'readAt', t.read_at
  ) order by t.created_at desc, t.id desc), '[]'::jsonb)
  into items
  from (
    select n.id, n.event_type, n.duel_id, n.proposal_id, n.title, n.body, n.created_at, n.read_at
    from public.tapact_notifications n
    where n.recipient_id = uid
      and (
        p_before is null
        or (n.created_at, n.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
    order by n.created_at desc, n.id desc
    limit take
  ) t;

  return jsonb_build_object(
    'unread', unread,
    'hasMore', fetched > take,
    'items', coalesce(items, '[]'::jsonb)
  );
end;
$$;

create or replace function public.tapact_mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_id is null then
    return;
  end if;
  update public.tapact_notifications
  set read_at = coalesce(read_at, now())
  where id = p_id and recipient_id = uid;
end;
$$;

create or replace function public.tapact_mark_all_notifications_read()
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
  update public.tapact_notifications
  set read_at = now()
  where recipient_id = uid and read_at is null;
end;
$$;

drop trigger if exists tapact_duels_notify_status on public.tapact_duels;
create trigger tapact_duels_notify_status
  after update of status on public.tapact_duels
  for each row execute function public.tapact_notify_duel_status();

drop trigger if exists tapact_duel_members_notify_left on public.tapact_duel_members;
create trigger tapact_duel_members_notify_left
  after update of status on public.tapact_duel_members
  for each row execute function public.tapact_notify_duel_departure();

drop trigger if exists tapact_duel_proposals_notify on public.tapact_duel_proposals;
create trigger tapact_duel_proposals_notify
  after insert or update of status on public.tapact_duel_proposals
  for each row execute function public.tapact_notify_duel_proposal();

revoke all on function public.tapact_emit_notification(uuid, text, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.tapact_notify_duel_status() from public, anon, authenticated;
revoke all on function public.tapact_notify_duel_departure() from public, anon, authenticated;
revoke all on function public.tapact_notify_duel_proposal() from public, anon, authenticated;

revoke all on function public.tapact_reconcile_duel_notifications() from public, anon;
revoke all on function public.tapact_list_notifications(integer, timestamptz, uuid) from public, anon;
revoke all on function public.tapact_mark_notification_read(uuid) from public, anon;
revoke all on function public.tapact_mark_all_notifications_read() from public, anon;

grant execute on function public.tapact_reconcile_duel_notifications() to authenticated;
grant execute on function public.tapact_list_notifications(integer, timestamptz, uuid) to authenticated;
grant execute on function public.tapact_mark_notification_read(uuid) to authenticated;
grant execute on function public.tapact_mark_all_notifications_read() to authenticated;

commit;
