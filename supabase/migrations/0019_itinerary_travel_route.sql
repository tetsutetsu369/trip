-- 移動区間ごとに、予定の場所とは別の出発地・目的地も指定できるようにする。
alter table public.itinerary_items
  add column travel_origin text not null default '',
  add column travel_destination text not null default '';

drop function if exists public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, boolean, integer, text, uuid[]);

create function public.save_itinerary_item_with_place(
  target_trip_id uuid,
  target_item_id uuid,
  expected_version integer,
  item_event_date date,
  item_event_time time,
  item_title text,
  item_place text,
  item_place_id uuid,
  item_group_label text,
  item_notes text,
  item_travel_minutes integer,
  item_travel_distance_km numeric,
  item_travel_mode text,
  item_travel_origin text,
  item_travel_destination text,
  item_travel_uses_toll_road boolean,
  item_travel_estimated_cost integer,
  item_travel_notes text,
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

  if greatest(coalesce(item_travel_minutes, 0), 0) <> coalesce(item_travel_minutes, 0)
    or greatest(coalesce(item_travel_estimated_cost, 0), 0) <> coalesce(item_travel_estimated_cost, 0)
    or greatest(coalesce(item_travel_distance_km, 0), 0) <> coalesce(item_travel_distance_km, 0)
    or coalesce(item_travel_mode, 'car') not in ('car', 'train', 'bus', 'taxi', 'walk', 'bicycle', 'other') then
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
  set place_id = item_place_id,
      group_label = coalesce(nullif(btrim(item_group_label), ''), '全員'),
      travel_minutes = greatest(coalesce(item_travel_minutes, 0), 0),
      travel_distance_km = greatest(coalesce(item_travel_distance_km, 0), 0),
      travel_mode = coalesce(nullif(item_travel_mode, ''), 'car'),
      travel_origin = coalesce(btrim(item_travel_origin), ''),
      travel_destination = coalesce(btrim(item_travel_destination), ''),
      travel_uses_toll_road = coalesce(item_travel_uses_toll_road, false),
      travel_estimated_cost = greatest(coalesce(item_travel_estimated_cost, 0), 0),
      travel_notes = coalesce(btrim(item_travel_notes), '')
  where id = saved_id and trip_id = target_trip_id;

  select version into saved_version from public.itinerary_items where id = saved_id;
  return result || jsonb_build_object('version', saved_version);
end;
$$;

revoke all on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, text, text, boolean, integer, text, uuid[]) from public;
grant execute on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, text, text, boolean, integer, text, uuid[]) to authenticated;
