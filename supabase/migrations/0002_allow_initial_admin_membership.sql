-- The first authenticated user is promoted by the application as the
-- initial administrator. Allow that one-time approved insert while keeping
-- subsequent self-created memberships pending.
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
        and not exists (
          select 1
          from public.trip_members existing
          where existing.trip_id = trip_members.trip_id
        )
      )
    )
  );
