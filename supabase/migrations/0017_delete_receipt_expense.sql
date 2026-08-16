-- レシートと、登録時に同時作成した費用・明細・負担額を一括削除する。
create or replace function public.delete_receipt_expense(
  target_receipt_id uuid,
  expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_trip_id uuid;
  receipt_version integer;
begin
  select trip_id, version
    into receipt_trip_id, receipt_version
    from public.receipts
   where id = target_receipt_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not public.is_trip_member(receipt_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if expected_version is not null and receipt_version <> expected_version then
    return jsonb_build_object('status', 'conflict');
  end if;

  delete from public.expenses
   where receipt_id = target_receipt_id
     and trip_id = receipt_trip_id;

  delete from public.receipts
   where id = target_receipt_id
     and version = receipt_version;

  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;

  return jsonb_build_object('status', 'ok');
end;
$$;
