-- Keep the existing itinerary save contract intact and add a place-aware RPC.
create or replace function public.save_itinerary_item_with_place(
  target_trip_id uuid,
  target_item_id uuid,
  expected_version integer,
  item_event_date date,
  item_event_time time,
  item_title text,
  item_place text,
  item_place_id uuid,
  item_notes text,
  assignee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  saved_id uuid;
  saved_version integer;
begin
  if item_place_id is not null and not exists (
    select 1 from public.trip_places where id = item_place_id and trip_id = target_trip_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  result := public.save_itinerary_item(
    target_trip_id,
    target_item_id,
    expected_version,
    item_event_date,
    item_event_time,
    item_title,
    item_place,
    item_notes,
    assignee_ids
  );

  if result->>'status' <> 'ok' then
    return result;
  end if;

  saved_id := (result->>'id')::uuid;
  update public.itinerary_items
  set place_id = item_place_id
  where id = saved_id and trip_id = target_trip_id;

  select version into saved_version from public.itinerary_items where id = saved_id;
  return result || jsonb_build_object('version', saved_version);
end;
$$;

revoke all on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, uuid[]) from public;
grant execute on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, uuid[]) to authenticated;
