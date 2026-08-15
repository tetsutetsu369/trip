-- 変更履歴を実際に残す。
--
-- change_logs はテーブル・索引・読み取りポリシーまで揃っているのに、書き込む
-- 手段が無いため1件も記録されていなかった。insert ポリシーはあえて付けない：
-- RLS有効＋insertポリシー無しならクライアントからは1件も書けず、テーブル所有者
-- として動く security definer のこのトリガだけが書ける。履歴の偽造を防ぐため。
--
-- 更新と履歴は同じトリガの中で走るので、自動的に同一トランザクションになる。

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  payload_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  rec jsonb := coalesce(payload_new, payload_old);
  target_trip_id uuid;
  target_record_id uuid;
  actor uuid;
  changed jsonb := '{}'::jsonb;
  field text;
begin
  -- trip_id は各テーブルの列から。子テーブルは親を引いて埋める。
  if rec ? 'trip_id' then
    target_trip_id := (rec ->> 'trip_id')::uuid;
  elsif tg_table_name = 'receipt_items' then
    select trip_id into target_trip_id from public.receipts where id = (rec ->> 'receipt_id')::uuid;
  elsif tg_table_name = 'expense_shares' then
    select trip_id into target_trip_id from public.expenses where id = (rec ->> 'expense_id')::uuid;
  end if;

  -- 親が on delete cascade で先に消えている場合、子の trip_id は引けない。
  -- そのときは親側の削除履歴に丸ごと残っているので、ここは記録しない。
  if target_trip_id is null then
    return null;
  end if;

  -- trip_settings は主キーが trip_id で id 列を持たない。
  target_record_id := coalesce(nullif(rec ->> 'id', ''), rec ->> 'trip_id')::uuid;

  -- 更新者はトリガ内で確定させ、クライアントからは受け取らない。
  select id into actor from public.profiles where id = auth.uid();

  if tg_op = 'UPDATE' then
    -- 変わった列だけを拾う。updated_at と version は毎回変わるので数えない。
    for field in select jsonb_object_keys(payload_new) loop
      if field not in ('updated_at', 'version', 'created_at')
        and payload_new -> field is distinct from payload_old -> field then
        changed := changed || jsonb_build_object(
          field,
          jsonb_build_object('before', payload_old -> field, 'after', payload_new -> field)
        );
      end if;
    end loop;
    -- 中身が変わっていない更新は記録しない。
    if changed = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.change_logs (
    trip_id, actor_user_id, table_name, record_id, action, changed_fields, before_value, after_value
  ) values (
    target_trip_id, actor, tg_table_name, target_record_id, lower(tg_op), changed, payload_old, payload_new
  );

  return null;
end;
$$;

create trigger itinerary_items_log_change after insert or update or delete on public.itinerary_items for each row execute function public.log_change();
create trigger packing_items_log_change after insert or update or delete on public.packing_items for each row execute function public.log_change();
create trigger shared_notes_log_change after insert or update or delete on public.shared_notes for each row execute function public.log_change();
create trigger purchases_log_change after insert or update or delete on public.purchases for each row execute function public.log_change();
create trigger rentals_log_change after insert or update or delete on public.rentals for each row execute function public.log_change();
create trigger receipts_log_change after insert or update or delete on public.receipts for each row execute function public.log_change();
create trigger receipt_items_log_change after insert or update or delete on public.receipt_items for each row execute function public.log_change();
create trigger expenses_log_change after insert or update or delete on public.expenses for each row execute function public.log_change();
create trigger expense_shares_log_change after insert or update or delete on public.expense_shares for each row execute function public.log_change();
create trigger trip_settings_log_change after insert or update or delete on public.trip_settings for each row execute function public.log_change();

-- trip_members は管理者APIが別途扱うため除外、profiles は本人以外の変更が無いため除外。
-- trip_places / settlements は、それぞれのテーブルを作る時点で同じトリガを付ける。
