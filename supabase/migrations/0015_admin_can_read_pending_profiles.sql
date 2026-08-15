-- Admins need to see the LINE profile attached to a pending application.
-- Approved members can still see only other approved members' profiles.

-- Remove legacy rejected applications and any participant data they may have
-- acquired before the rejection flow was made permanent.
delete from public.itinerary_assignees assignments
using public.trip_participants participants
join public.trip_members members
  on members.trip_id = participants.trip_id
 and members.user_id = participants.profile_id
where assignments.participant_id = participants.id
  and members.status = 'rejected';

delete from public.trip_participants participants
using public.trip_members members
where members.trip_id = participants.trip_id
  and members.user_id = participants.profile_id
  and members.status = 'rejected';

delete from public.trip_members
where status = 'rejected';

drop policy if exists "users can read profiles in their trips" on public.profiles;

create policy "users can read profiles in their trips" on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from public.trip_members viewer
      join public.trip_members target on target.trip_id = viewer.trip_id
      where viewer.user_id = auth.uid() and viewer.status = 'approved'
        and target.user_id = profiles.id
        and (
          target.status = 'approved'
          or (viewer.role = 'admin' and target.status = 'pending')
        )
    )
  );
