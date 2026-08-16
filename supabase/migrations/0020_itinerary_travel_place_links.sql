-- 移動区間の出発地・目的地を、登録済みの場所へ安定して紐づける。
alter table public.itinerary_items
  add column travel_origin_place_id uuid references public.trip_places(id) on delete set null,
  add column travel_destination_place_id uuid references public.trip_places(id) on delete set null;

-- 既存の自由入力が、後から登録された場所名と一致する場合も初回に紐づける。
update public.itinerary_items items
set travel_origin_place_id = places.id
from public.trip_places places
where items.trip_id = places.trip_id
  and items.travel_origin_place_id is null
  and btrim(items.travel_origin) <> ''
  and lower(btrim(items.travel_origin)) = lower(btrim(places.name));

update public.itinerary_items items
set travel_destination_place_id = places.id
from public.trip_places places
where items.trip_id = places.trip_id
  and items.travel_destination_place_id is null
  and btrim(items.travel_destination) <> ''
  and lower(btrim(items.travel_destination)) = lower(btrim(places.name));

-- 場所を後から追加した場合も、同じ名前の移動区間へ自動で紐づける。
create or replace function public.bind_itinerary_travel_places()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.itinerary_items
  set travel_origin_place_id = case
        when travel_origin_place_id is null
          and lower(btrim(travel_origin)) = lower(btrim(new.name)) then new.id
        else travel_origin_place_id
      end,
      travel_destination_place_id = case
        when travel_destination_place_id is null
          and lower(btrim(travel_destination)) = lower(btrim(new.name)) then new.id
        else travel_destination_place_id
      end
  where trip_id = new.trip_id
    and ((travel_origin_place_id is null and lower(btrim(travel_origin)) = lower(btrim(new.name)))
      or (travel_destination_place_id is null and lower(btrim(travel_destination)) = lower(btrim(new.name))));
  return new;
end;
$$;

drop trigger if exists trip_places_bind_itinerary_travel on public.trip_places;
create trigger trip_places_bind_itinerary_travel
  after insert or update of name on public.trip_places
  for each row execute function public.bind_itinerary_travel_places();

-- 出発地・目的地の場所IDを保存できる契約へ切り替える。
drop function if exists public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, text, text, boolean, integer, text, uuid[]);
drop function if exists public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, uuid, uuid, text, text, boolean, integer, text, uuid[]);

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
  item_travel_origin_place_id uuid,
  item_travel_destination_place_id uuid,
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
  resolved_origin_place_id uuid := item_travel_origin_place_id;
  resolved_destination_place_id uuid := item_travel_destination_place_id;
begin
  if item_place_id is not null and not exists (
    select 1 from public.trip_places where id = item_place_id and trip_id = target_trip_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if resolved_origin_place_id is null and btrim(coalesce(item_travel_origin, '')) <> '' then
    select id into resolved_origin_place_id
    from public.trip_places
    where trip_id = target_trip_id
      and lower(btrim(name)) = lower(btrim(item_travel_origin))
    order by created_at
    limit 1;
  end if;
  if resolved_destination_place_id is null and btrim(coalesce(item_travel_destination, '')) <> '' then
    select id into resolved_destination_place_id
    from public.trip_places
    where trip_id = target_trip_id
      and lower(btrim(name)) = lower(btrim(item_travel_destination))
    order by created_at
    limit 1;
  end if;

  if (resolved_origin_place_id is not null and not exists (
    select 1 from public.trip_places where id = resolved_origin_place_id and trip_id = target_trip_id
  )) or (resolved_destination_place_id is not null and not exists (
    select 1 from public.trip_places where id = resolved_destination_place_id and trip_id = target_trip_id
  )) then
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
      travel_origin_place_id = resolved_origin_place_id,
      travel_destination_place_id = resolved_destination_place_id,
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

revoke all on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, uuid, uuid, text, text, boolean, integer, text, uuid[]) from public;
grant execute on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, integer, numeric, text, uuid, uuid, text, text, boolean, integer, text, uuid[]) to authenticated;
