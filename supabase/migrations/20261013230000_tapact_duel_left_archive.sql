-- TapAct Phase 8A.4: a member who already left may hide the duel from their list.
-- Archive still writes only that member's hidden_at. The shared duel, opponent
-- membership, scores, live status, and tracking history stay unchanged.
-- Restore only clears hidden_at. It does not rejoin the member or restart scoring.

begin;

create or replace function public.tapact_archive_duel(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.tapact_duels%rowtype;
  m public.tapact_duel_members%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to manage this duel.';
  end if;
  select * into d from public.tapact_duels where id = p_duel for update;
  if d.id is null then
    raise exception 'You are not in this duel.';
  end if;
  select * into m from public.tapact_duel_members where duel_id = p_duel and user_id = uid;
  if m.user_id is null then
    raise exception 'You are not in this duel.';
  end if;
  if not (
    d.status in ('completed', 'cancelled')
    or (d.status = 'active' and m.status = 'left')
  ) then
    raise exception 'Only finished, cancelled, or left duels can be removed from your list.';
  end if;
  update public.tapact_duel_members
  set hidden_at = coalesce(hidden_at, now())
  where duel_id = p_duel and user_id = uid;
  if not found then
    raise exception 'You are not in this duel.';
  end if;
end;
$$;

revoke all on function public.tapact_archive_duel(uuid) from public, anon;
grant execute on function public.tapact_archive_duel(uuid) to authenticated;

commit;
