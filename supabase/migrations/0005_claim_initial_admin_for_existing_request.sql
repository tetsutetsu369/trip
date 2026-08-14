-- Recover a pending first request created before the initial-admin RLS fix.
-- Only the current user can be promoted, and only while no approved member
-- exists for the trip.
create or replace function public.claim_initial_admin(target_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if exists (
    select 1
    from public.trip_members
    where trip_id = target_trip_id
      and status = 'approved'
  ) then
    return false;
  end if;

  update public.trip_members
  set status = 'approved',
      role = 'admin',
      approved_at = now(),
      removed_at = null,
      version = version + 1
  where trip_id = target_trip_id
    and user_id = auth.uid()
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.claim_initial_admin(uuid) from public;
grant execute on function public.claim_initial_admin(uuid) to authenticated;
