-- Avoid querying trip_members directly from its own INSERT policy. The
-- SECURITY DEFINER helper performs the existence check outside that policy.
create or replace function public.trip_has_members(target_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = target_trip_id
  );
$$;

revoke all on function public.trip_has_members(uuid) from public;
grant execute on function public.trip_has_members(uuid) to authenticated;

drop policy if exists "users can request membership" on public.trip_members;

create policy "users can request membership" on public.trip_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      status = 'pending'
      or (
        status = 'approved'
        and role = 'admin'
        and not public.trip_has_members(trip_members.trip_id)
      )
    )
  );
