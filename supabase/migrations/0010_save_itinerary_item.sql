-- 旅程本体と担当者を1トランザクションで保存する。
--
-- これまでは本体を更新したあとクライアントが担当者を全削除→再挿入していたため、
-- 挿入が失敗すると削除だけが残り、担当者が全部消える経路になっていた。また新規
-- 作成時は予定が保存済みでも担当者の登録に失敗すると「保存できませんでした」と
-- 表示され、実態と食い違っていた。
--
-- CRUD 全体を RPC に寄せる方針ではない（持ち物・メモは単一テーブルなので従来
-- どおりクライアントから直接更新する）。複数テーブルにまたがる複合操作だけを
-- ここにまとめる。

create or replace function public.save_itinerary_item(
  target_trip_id uuid,
  target_item_id uuid,
  expected_version integer,
  item_event_date date,
  item_event_time time,
  item_title text,
  item_place text,
  item_notes text,
  assignee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
  saved_version integer;
  next_order integer;
  clean_ids uuid[] := coalesce(assignee_ids, '{}'::uuid[]);
begin
  if not public.is_trip_member(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if coalesce(btrim(item_title), '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- 担当者は同じ旅行の参加者に限る。
  if exists (
    select 1
    from unnest(clean_ids) as candidate(id)
    where not exists (
      select 1
      from public.trip_participants
      where trip_participants.id = candidate.id
        and trip_participants.trip_id = target_trip_id
    )
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if target_item_id is null then
    select coalesce(max(sort_order), -1) + 1
    into next_order
    from public.itinerary_items
    where trip_id = target_trip_id;

    insert into public.itinerary_items (trip_id, event_date, event_time, title, place, notes, sort_order, created_by)
    values (
      target_trip_id,
      item_event_date,
      item_event_time,
      btrim(item_title),
      coalesce(btrim(item_place), ''),
      coalesce(btrim(item_notes), ''),
      next_order,
      auth.uid()
    )
    returning id, version into saved_id, saved_version;
  else
    update public.itinerary_items
    set event_date = item_event_date,
        event_time = item_event_time,
        title = btrim(item_title),
        place = coalesce(btrim(item_place), ''),
        notes = coalesce(btrim(item_notes), '')
    where id = target_item_id
      and trip_id = target_trip_id
      and version = expected_version
    returning id, version into saved_id, saved_version;

    -- 更新0件は、他の人が先に保存したか、予定そのものが消えたかのどちらか。
    if saved_id is null then
      return jsonb_build_object('status', 'conflict');
    end if;

    delete from public.itinerary_assignees where itinerary_item_id = saved_id;
  end if;

  insert into public.itinerary_assignees (itinerary_item_id, participant_id)
  select saved_id, candidate.id from unnest(clean_ids) as candidate(id)
  on conflict do nothing;

  return jsonb_build_object('status', 'ok', 'id', saved_id, 'version', saved_version);
end;
$$;

revoke all on function public.save_itinerary_item(uuid, uuid, integer, date, time, text, text, text, uuid[]) from public;
grant execute on function public.save_itinerary_item(uuid, uuid, integer, date, time, text, text, text, uuid[]) to authenticated;
