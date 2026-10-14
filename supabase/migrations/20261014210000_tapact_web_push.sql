-- TapAct Phase 9A.2: opt-in Web Push for existing duel notifications.
--
-- In-app rows in tapact_notifications stay the source of truth. This migration
-- adds per-account preferences, per-device subscriptions, and a delivery outbox.
-- It does not create a second event system and does not change duel scoring.
--
-- Ordinary authenticated users can register and remove only their own device
-- and edit only their own preferences. They cannot read other people's
-- endpoints or write delivery rows.
--
-- tapact_reconcile_due_duel_notifications, tapact_claim_push_deliveries, and
-- tapact_finish_push_delivery are granted only to service_role. A signed-in
-- user cannot run the global reconcile or send push.
--
-- Time-based notices (official start, rules taking effect, duel finished) are
-- still created with the same dates and frozen time zones as Phase 9A.1.
-- Already completed, cancelled, and pending duels are not backfilled.
-- PostgreSQL does not run a background scheduler. A server worker must call
-- the service-role functions.
--
-- A delivery is marked sent only after the push service accepts it. Claiming
-- uses SKIP LOCKED so two workers do not send the same pending row. Each claim
-- gets a new claim_token. Finish and the pre-send check ignore any other token,
-- so a stale worker cannot complete a delivery that was reclaimed or moved to
-- another account. Sending also requires the subscription owner to still be
-- the notification recipient.
--
-- Web Push is still at-least-once: a crash after the push service accepts a
-- message and before the worker records it can produce another attempt. A
-- message already accepted cannot be recalled if the account changes during
-- that send. The device is not guaranteed to display every accepted message
-- exactly once. The daily worker is a sweep, not a timely-delivery guarantee.

begin;

create table if not exists public.tapact_push_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default false,
  invite_accepted boolean not null default true,
  duel_started boolean not null default true,
  proposal_received boolean not null default true,
  proposal_approved boolean not null default true,
  proposal_rejected boolean not null default true,
  rules_effective boolean not null default true,
  duel_finished boolean not null default true,
  opponent_left boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.tapact_push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint tapact_push_subscriptions_endpoint_len check (char_length(endpoint) between 20 and 2000),
  constraint tapact_push_subscriptions_p256dh_len check (char_length(p256dh) between 40 and 200),
  constraint tapact_push_subscriptions_auth_len check (char_length(auth_key) between 16 and 64)
);

create unique index if not exists tapact_push_subscriptions_endpoint_uidx
  on public.tapact_push_subscriptions (endpoint);

create index if not exists tapact_push_subscriptions_user_idx
  on public.tapact_push_subscriptions (user_id)
  where disabled_at is null;

create table if not exists public.tapact_push_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.tapact_notifications (id) on delete cascade,
  subscription_id uuid not null references public.tapact_push_subscriptions (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  claim_token uuid,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);

create index if not exists tapact_push_deliveries_due_idx
  on public.tapact_push_deliveries (next_attempt_at, id)
  where status in ('pending', 'failed', 'sending');

alter table public.tapact_push_preferences enable row level security;
alter table public.tapact_push_preferences force row level security;
alter table public.tapact_push_subscriptions enable row level security;
alter table public.tapact_push_subscriptions force row level security;
alter table public.tapact_push_deliveries enable row level security;
alter table public.tapact_push_deliveries force row level security;

revoke all on public.tapact_push_preferences from anon, authenticated;
revoke all on public.tapact_push_subscriptions from anon, authenticated;
revoke all on public.tapact_push_deliveries from anon, authenticated;

create or replace function public.tapact_push_endpoint_ok(p_endpoint text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  host text;
begin
  if p_endpoint is null or char_length(p_endpoint) < 20 or char_length(p_endpoint) > 2000 then
    return false;
  end if;
  if p_endpoint !~ '^https://' then
    return false;
  end if;
  host := lower(split_part(substring(p_endpoint from '^https://([^/]+)'), ':', 1));
  return host = 'fcm.googleapis.com'
    or host = 'updates.push.services.mozilla.com'
    or host = 'web.push.apple.com'
    or host = 'notify.windows.com'
    or host like '%.notify.windows.com';
end;
$$;

create or replace function public.tapact_push_event_allowed(
  prefs public.tapact_push_preferences,
  p_event text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select prefs.push_enabled and case p_event
    when 'invite_accepted' then prefs.invite_accepted
    when 'duel_started' then prefs.duel_started
    when 'proposal_received' then prefs.proposal_received
    when 'proposal_approved' then prefs.proposal_approved
    when 'proposal_rejected' then prefs.proposal_rejected
    when 'rules_effective' then prefs.rules_effective
    when 'duel_finished' then prefs.duel_finished
    when 'opponent_left' then prefs.opponent_left
    else false
  end;
$$;

create or replace function public.tapact_cancel_open_push_deliveries(p_subscription uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tapact_push_deliveries
  set status = 'cancelled', claim_token = null
  where subscription_id = p_subscription
    and status in ('pending', 'failed', 'sending');
$$;

create or replace function public.tapact_get_push_settings(p_endpoint text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prefs public.tapact_push_preferences%rowtype;
  registered boolean := false;
  devices integer := 0;
  last_error text;
begin
  if uid is null then
    return jsonb_build_object('signedIn', false);
  end if;

  select * into prefs from public.tapact_push_preferences where user_id = uid;
  select count(*) into devices
  from public.tapact_push_subscriptions s
  where s.user_id = uid and s.disabled_at is null;

  if p_endpoint is not null and public.tapact_push_endpoint_ok(p_endpoint) then
    select true into registered
    from public.tapact_push_subscriptions s
    where s.user_id = uid and s.endpoint = p_endpoint and s.disabled_at is null;
  end if;

  select left(d.last_error, 140) into last_error
  from public.tapact_push_deliveries d
  join public.tapact_push_subscriptions s on s.id = d.subscription_id
  where s.user_id = uid and d.last_error is not null
  order by d.created_at desc
  limit 1;

  return jsonb_build_object(
    'signedIn', true,
    'pushEnabled', coalesce(prefs.push_enabled, false),
    'deviceRegistered', coalesce(registered, false),
    'deviceCount', devices,
    'lastError', last_error,
    'events', jsonb_build_object(
      'invite_accepted', coalesce(prefs.invite_accepted, true),
      'duel_started', coalesce(prefs.duel_started, true),
      'proposal_received', coalesce(prefs.proposal_received, true),
      'proposal_approved', coalesce(prefs.proposal_approved, true),
      'proposal_rejected', coalesce(prefs.proposal_rejected, true),
      'rules_effective', coalesce(prefs.rules_effective, true),
      'duel_finished', coalesce(prefs.duel_finished, true),
      'opponent_left', coalesce(prefs.opponent_left, true)
    )
  );
end;
$$;

create or replace function public.tapact_set_push_preferences(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  events jsonb := coalesce(payload -> 'events', '{}'::jsonb);
begin
  if uid is null then
    raise exception 'Sign in to change notification settings.';
  end if;

  insert into public.tapact_push_preferences as prefs (
    user_id, push_enabled,
    invite_accepted, duel_started, proposal_received, proposal_approved,
    proposal_rejected, rules_effective, duel_finished, opponent_left
  ) values (
    uid,
    coalesce((payload ->> 'pushEnabled')::boolean, false),
    coalesce((events ->> 'invite_accepted')::boolean, true),
    coalesce((events ->> 'duel_started')::boolean, true),
    coalesce((events ->> 'proposal_received')::boolean, true),
    coalesce((events ->> 'proposal_approved')::boolean, true),
    coalesce((events ->> 'proposal_rejected')::boolean, true),
    coalesce((events ->> 'rules_effective')::boolean, true),
    coalesce((events ->> 'duel_finished')::boolean, true),
    coalesce((events ->> 'opponent_left')::boolean, true)
  )
  on conflict (user_id) do update set
    push_enabled = coalesce((payload ->> 'pushEnabled')::boolean, prefs.push_enabled),
    invite_accepted = coalesce((events ->> 'invite_accepted')::boolean, prefs.invite_accepted),
    duel_started = coalesce((events ->> 'duel_started')::boolean, prefs.duel_started),
    proposal_received = coalesce((events ->> 'proposal_received')::boolean, prefs.proposal_received),
    proposal_approved = coalesce((events ->> 'proposal_approved')::boolean, prefs.proposal_approved),
    proposal_rejected = coalesce((events ->> 'proposal_rejected')::boolean, prefs.proposal_rejected),
    rules_effective = coalesce((events ->> 'rules_effective')::boolean, prefs.rules_effective),
    duel_finished = coalesce((events ->> 'duel_finished')::boolean, prefs.duel_finished),
    opponent_left = coalesce((events ->> 'opponent_left')::boolean, prefs.opponent_left),
    updated_at = now();

  return public.tapact_get_push_settings(null);
end;
$$;

create or replace function public.tapact_register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing public.tapact_push_subscriptions%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to enable notifications on this device.';
  end if;
  if not public.tapact_push_endpoint_ok(p_endpoint) then
    raise exception 'That push endpoint is not accepted.';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{40,200}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'That push subscription is not valid.';
  end if;

  select * into existing from public.tapact_push_subscriptions where endpoint = p_endpoint for update;
  if existing.id is not null and existing.user_id <> uid then
    perform public.tapact_cancel_open_push_deliveries(existing.id);
  end if;

  insert into public.tapact_push_subscriptions (user_id, endpoint, p256dh, auth_key, expiration_time)
  values (uid, p_endpoint, p_p256dh, p_auth, p_expiration)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key,
    expiration_time = excluded.expiration_time,
    disabled_at = null,
    updated_at = now();
end;
$$;

create or replace function public.tapact_unregister_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sub_id uuid;
begin
  if uid is null or p_endpoint is null then
    return;
  end if;
  select id into sub_id
  from public.tapact_push_subscriptions
  where user_id = uid and endpoint = p_endpoint
  for update;
  if sub_id is null then
    return;
  end if;
  perform public.tapact_cancel_open_push_deliveries(sub_id);
  update public.tapact_push_subscriptions
  set disabled_at = coalesce(disabled_at, now()), updated_at = now()
  where id = sub_id and user_id = uid;
end;
$$;

-- Enqueue only. Sending happens in the server worker. Failures here must not
-- roll back the in-app notification or the duel action that created it.
create or replace function public.tapact_enqueue_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefs public.tapact_push_preferences%rowtype;
begin
  select * into prefs from public.tapact_push_preferences where user_id = new.recipient_id;
  if prefs.user_id is null or not public.tapact_push_event_allowed(prefs, new.event_type) then
    return new;
  end if;

  insert into public.tapact_push_deliveries (notification_id, subscription_id)
  select new.id, s.id
  from public.tapact_push_subscriptions s
  where s.user_id = new.recipient_id and s.disabled_at is null
  on conflict (notification_id, subscription_id) do nothing;

  return new;
exception when others then
  return new;
end;
$$;

-- Same start, rule, and finish rules as tapact_reconcile_duel_notifications,
-- for every active duel. Not granted to authenticated users.
create or replace function public.tapact_reconcile_due_duel_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  duel_id uuid;
  d public.tapact_duels%rowtype;
  zone_a text;
  zone_b text;
  later timestamptz;
  member record;
  rule record;
  reader record;
begin
  for duel_id in
    select d0.id
    from public.tapact_duels d0
    where d0.status = 'active'
    order by d0.id
  loop
    select * into d from public.tapact_duels where id = duel_id for update;
    if d.id is null or d.status is distinct from 'active' then
      continue;
    end if;

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

    select m.time_zone into zone_a
    from public.tapact_duel_members m
    where m.duel_id = d.id
    order by m.user_id
    limit 1;
    select m.time_zone into zone_b
    from public.tapact_duel_members m
    where m.duel_id = d.id
    order by m.user_id
    offset 1
    limit 1;

    if zone_a is not null and zone_b is not null then
      later := greatest(
        (d.starts_on + d.duration_days)::timestamp at time zone zone_a,
        (d.starts_on + d.duration_days)::timestamp at time zone zone_b
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

create or replace function public.tapact_claim_push_deliveries(
  p_batch integer default 4,
  p_worker text default 'worker'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  take integer := least(greatest(coalesce(p_batch, 4), 1), 4);
  result jsonb := '[]'::jsonb;
begin
  with due as (
    select d.id
    from public.tapact_push_deliveries d
    join public.tapact_push_subscriptions s on s.id = d.subscription_id and s.disabled_at is null
    join public.tapact_notifications n on n.id = d.notification_id and n.recipient_id = s.user_id
    join public.tapact_push_preferences p on p.user_id = n.recipient_id and p.push_enabled
      and public.tapact_push_event_allowed(p, n.event_type)
    where (
      d.status in ('pending', 'failed') and d.next_attempt_at <= now() and d.attempts < 5
    ) or (
      d.status = 'sending' and d.claimed_at < now() - interval '10 minutes'
    )
    order by d.next_attempt_at, d.id
    limit take
    for update of d skip locked
  ),
  updated as (
    update public.tapact_push_deliveries d
    set status = 'sending',
        claimed_at = clock_timestamp(),
        claimed_by = left(coalesce(p_worker, 'worker'), 80),
        claim_token = extensions.gen_random_uuid()
    from due
    where d.id = due.id
    returning d.id, d.notification_id, d.subscription_id, d.claim_token
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id,
    'claimToken', u.claim_token,
    'notificationId', n.id,
    'title', n.title,
    'body', n.body,
    'duelId', n.duel_id,
    'endpoint', s.endpoint,
    'p256dh', s.p256dh,
    'authKey', s.auth_key
  )), '[]'::jsonb)
  into result
  from updated u
  join public.tapact_notifications n on n.id = u.notification_id
  join public.tapact_push_subscriptions s on s.id = u.subscription_id and s.user_id = n.recipient_id and s.disabled_at is null;

  return coalesce(result, '[]'::jsonb);
end;
$$;

-- Last check before the worker contacts the push service. A mismatched account,
-- a disabled subscription, or a replaced claim cancels this row and returns false.
create or replace function public.tapact_prepare_push_send(
  p_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.tapact_push_deliveries%rowtype;
  recipient uuid;
  owner uuid;
  event_name text;
  prefs public.tapact_push_preferences%rowtype;
begin
  select * into row from public.tapact_push_deliveries where id = p_id for update;
  if row.id is null or row.status <> 'sending' or row.claim_token is distinct from p_claim_token then
    return false;
  end if;

  select n.recipient_id, s.user_id, n.event_type
  into recipient, owner, event_name
  from public.tapact_notifications n
  join public.tapact_push_subscriptions s on s.id = row.subscription_id and s.disabled_at is null
  where n.id = row.notification_id;

  select * into prefs from public.tapact_push_preferences where user_id = recipient;
  if recipient is null or owner is distinct from recipient or prefs.user_id is null
     or coalesce(public.tapact_push_event_allowed(prefs, event_name), false) = false then
    update public.tapact_push_deliveries
    set status = 'cancelled', claim_token = null
    where id = row.id and status = 'sending' and claim_token = p_claim_token;
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.tapact_finish_push_delivery(
  p_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.tapact_push_deliveries%rowtype;
  recipient uuid;
  owner uuid;
  next_attempts integer;
begin
  select * into row from public.tapact_push_deliveries where id = p_id for update;
  if row.id is null or row.status <> 'sending' or row.claim_token is distinct from p_claim_token then
    return;
  end if;

  select n.recipient_id, s.user_id
  into recipient, owner
  from public.tapact_notifications n
  join public.tapact_push_subscriptions s on s.id = row.subscription_id
  where n.id = row.notification_id;

  if recipient is null or owner is distinct from recipient then
    update public.tapact_push_deliveries
    set status = 'cancelled', claim_token = null
    where id = row.id and status = 'sending' and claim_token = p_claim_token;
    return;
  end if;

  if p_outcome = 'sent' then
    update public.tapact_push_deliveries
    set status = 'sent', sent_at = now(), last_error = null
    where id = row.id and status = 'sending' and claim_token = p_claim_token;
    return;
  end if;

  if p_outcome = 'invalid' then
    update public.tapact_push_deliveries
    set status = 'dead', attempts = attempts + 1, last_error = left(coalesce(p_error, 'Subscription is no longer valid.'), 180), claim_token = null
    where id = row.id and status = 'sending' and claim_token = p_claim_token;
    if not found then
      return;
    end if;
    update public.tapact_push_subscriptions
    set disabled_at = coalesce(disabled_at, now()), updated_at = now()
    where id = row.subscription_id and user_id = recipient;
    perform public.tapact_cancel_open_push_deliveries(row.subscription_id);
    return;
  end if;

  next_attempts := row.attempts + 1;
  if p_outcome = 'dead' or next_attempts >= 5 then
    update public.tapact_push_deliveries
    set status = 'dead', attempts = next_attempts, last_error = left(coalesce(p_error, 'This notice could not be delivered.'), 180), claim_token = null
    where id = row.id and status = 'sending' and claim_token = p_claim_token;
    return;
  end if;

  update public.tapact_push_deliveries
  set status = 'failed',
      attempts = next_attempts,
      next_attempt_at = now() + (interval '1 minute' * power(2, next_attempts - 1)),
      last_error = left(coalesce(p_error, 'The push service did not accept the notice yet.'), 180),
      claim_token = null
  where id = row.id and status = 'sending' and claim_token = p_claim_token;
end;
$$;

drop trigger if exists tapact_notifications_enqueue_push on public.tapact_notifications;
create trigger tapact_notifications_enqueue_push
  after insert on public.tapact_notifications
  for each row execute function public.tapact_enqueue_push_delivery();

revoke all on function public.tapact_push_endpoint_ok(text) from public, anon, authenticated;
revoke all on function public.tapact_push_event_allowed(public.tapact_push_preferences, text) from public, anon, authenticated;
revoke all on function public.tapact_cancel_open_push_deliveries(uuid) from public, anon, authenticated;
revoke all on function public.tapact_enqueue_push_delivery() from public, anon, authenticated;
revoke all on function public.tapact_reconcile_due_duel_notifications() from public, anon, authenticated;
revoke all on function public.tapact_claim_push_deliveries(integer, text) from public, anon, authenticated;
revoke all on function public.tapact_prepare_push_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tapact_finish_push_delivery(uuid, uuid, text, text) from public, anon, authenticated;

revoke all on function public.tapact_get_push_settings(text) from public, anon;
revoke all on function public.tapact_set_push_preferences(jsonb) from public, anon;
revoke all on function public.tapact_register_push_subscription(text, text, text, timestamptz) from public, anon;
revoke all on function public.tapact_unregister_push_subscription(text) from public, anon;

grant execute on function public.tapact_get_push_settings(text) to authenticated;
grant execute on function public.tapact_set_push_preferences(jsonb) to authenticated;
grant execute on function public.tapact_register_push_subscription(text, text, text, timestamptz) to authenticated;
grant execute on function public.tapact_unregister_push_subscription(text) to authenticated;

grant execute on function public.tapact_reconcile_due_duel_notifications() to service_role;
grant execute on function public.tapact_claim_push_deliveries(integer, text) to service_role;
grant execute on function public.tapact_prepare_push_send(uuid, uuid) to service_role;
grant execute on function public.tapact_finish_push_delivery(uuid, uuid, text, text) to service_role;

commit;
