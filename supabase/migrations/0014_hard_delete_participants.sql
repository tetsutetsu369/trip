-- Remove participants and memberships permanently when an administrator asks for deletion.
-- The security-definer functions keep the multi-table cleanup atomic while the
-- client remains unable to delete membership rows directly through RLS.

create or replace function public.admin_delete_trip_member(
  target_trip_id uuid,
  target_member_id uuid,
  expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  target_role text;
  target_status text;
  target_current_version integer;
  target_participant_id uuid;
  approved_admin_count integer;
begin
  if not public.is_trip_admin(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select user_id, role, status, version
  into target_user_id, target_role, target_status, target_current_version
  from public.trip_members
  where id = target_member_id and trip_id = target_trip_id
  for update;

  if target_user_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if target_user_id = auth.uid() then
    return jsonb_build_object('status', 'self_change');
  end if;
  if target_current_version <> expected_version then
    return jsonb_build_object('status', 'conflict');
  end if;

  if target_role = 'admin' and target_status = 'approved' then
    select count(*) into approved_admin_count
    from public.trip_members
    where trip_id = target_trip_id and role = 'admin' and status = 'approved';
    if approved_admin_count <= 1 then
      return jsonb_build_object('status', 'last_admin');
    end if;
  end if;

  select id into target_participant_id
  from public.trip_participants
  where trip_id = target_trip_id and profile_id = target_user_id;

  if target_participant_id is not null then
    delete from public.itinerary_assignees where participant_id = target_participant_id;
    delete from public.trip_participants where id = target_participant_id;
  end if;

  delete from public.trip_members where id = target_member_id;
  return jsonb_build_object('status', 'ok', 'member_id', target_member_id);
end;
$$;

create or replace function public.admin_delete_trip_participant(
  target_trip_id uuid,
  target_participant_id uuid,
  expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_version integer;
begin
  if not public.is_trip_admin(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select version into target_version
  from public.trip_participants
  where id = target_participant_id and trip_id = target_trip_id
  for update;

  if target_version is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if target_version <> expected_version then
    return jsonb_build_object('status', 'conflict');
  end if;

  delete from public.itinerary_assignees where participant_id = target_participant_id;
  delete from public.trip_participants where id = target_participant_id;
  return jsonb_build_object('status', 'ok', 'participant_id', target_participant_id);
end;
$$;

revoke all on function public.admin_delete_trip_member(uuid, uuid, integer) from public;
grant execute on function public.admin_delete_trip_member(uuid, uuid, integer) to authenticated;
revoke all on function public.admin_delete_trip_participant(uuid, uuid, integer) from public;
grant execute on function public.admin_delete_trip_participant(uuid, uuid, integer) to authenticated;
