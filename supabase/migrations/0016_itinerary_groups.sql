-- 予定ごとの行動グループを保存する。
-- 「全員」を初期値にして、途中で本隊・別働隊へ分かれる旅程も表現できるようにする。
alter table public.itinerary_items
  add column group_label text not null default '全員';

create index itinerary_items_trip_group_idx
  on public.itinerary_items (trip_id, group_label, event_date, event_time);

-- group_label を含む新しい保存契約に切り替える。
drop function if exists public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, uuid[]);

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
  set place_id = item_place_id,
      group_label = coalesce(nullif(btrim(item_group_label), ''), '全員')
  where id = saved_id and trip_id = target_trip_id;

  select version into saved_version from public.itinerary_items where id = saved_id;
  return result || jsonb_build_object('version', saved_version);
end;
$$;

revoke all on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, uuid[]) from public;
grant execute on function public.save_itinerary_item_with_place(uuid, uuid, integer, date, time, text, text, uuid, text, text, uuid[]) to authenticated;
