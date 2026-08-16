-- 費用・購入予定・立替を expenses に統合するための拡張。
-- amount は実績額、planned_amount は予定額として扱う。
alter table public.expenses
  add column if not exists planned_amount integer not null default 0 check (planned_amount >= 0),
  add column if not exists itinerary_item_id uuid references public.itinerary_items(id) on delete set null,
  add column if not exists purchase_id uuid references public.purchases(id) on delete set null,
  add column if not exists allocation_method text not null default 'equal_all';

alter table public.expenses
  add constraint expenses_allocation_method_check
  check (allocation_method in ('equal_all', 'equal_selected', 'custom', 'personal'));

-- 既存の実績費用は、移行後も同額を予定額として表示できるようにする。
update public.expenses
set planned_amount = amount
where planned_amount = 0 and amount > 0;

create index if not exists expenses_itinerary_item_idx on public.expenses (itinerary_item_id);
create unique index if not exists expenses_purchase_id_idx on public.expenses (purchase_id) where purchase_id is not null;

-- 旧購入品を予定／実績費用へ移行する。購入品テーブル自体は互換用に残す。
insert into public.expenses (
  trip_id, purchase_id, title, category, planned_amount, amount,
  payment_status, settlement_status, allocation_method, memo, created_by
)
select
  purchases.trip_id,
  purchases.id,
  purchases.name,
  purchases.category,
  greatest(purchases.planned_amount, purchases.purchased_amount),
  case when purchases.is_purchased then purchases.purchased_amount else 0 end,
  case when purchases.is_purchased then 'paid' else 'unpaid' end,
  'unsettled',
  'equal_all',
  purchases.memo,
  purchases.created_by
from public.purchases
where not exists (
  select 1 from public.expenses
  where expenses.purchase_id = purchases.id
);

-- 移行した購入品の負担額を、当時の承認済み参加者全員へ均等に作成する。
with ranked_shares as (
  select
    expenses.id as expense_id,
    members.user_id,
    case when expenses.payment_status = 'paid' then expenses.amount else expenses.planned_amount end as total_amount,
    count(*) over (partition by expenses.id) as share_count,
    row_number() over (partition by expenses.id order by members.user_id) as share_index
  from public.expenses
  join public.trip_members members
    on members.trip_id = expenses.trip_id
   and members.status = 'approved'
  where expenses.purchase_id is not null
)
insert into public.expense_shares (expense_id, user_id, amount)
select
  expense_id,
  user_id,
  (total_amount / share_count) + case when share_index <= (total_amount % share_count) then 1 else 0 end
from ranked_shares
where not exists (
  select 1 from public.expense_shares existing
  where existing.expense_id = ranked_shares.expense_id
);

-- 費用と負担額を1トランザクションで保存する共通RPC。
create or replace function public.save_expense_with_shares(
  target_trip_id uuid,
  target_expense_id uuid,
  expected_version integer,
  input_title text,
  input_category text,
  input_planned_amount integer,
  input_actual_amount integer,
  input_payment_status text,
  input_payer_id uuid,
  input_itinerary_item_id uuid,
  input_purchase_id uuid,
  input_receipt_id uuid,
  input_allocation_method text,
  input_share_user_ids uuid[],
  input_share_amounts jsonb,
  input_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_expense_id uuid;
  saved_version integer;
  current_version integer;
  next_actual_amount integer := case when input_payment_status = 'paid' then greatest(coalesce(input_actual_amount, 0), 0) else 0 end;
  next_planned_amount integer := greatest(coalesce(input_planned_amount, 0), 0);
  base_total integer;
  share_count integer := 0;
  share_base integer := 0;
  share_remainder integer := 0;
  share_index integer := 0;
  candidate uuid;
  candidate_amount integer;
  selected_ids uuid[];
  share_total integer := 0;
  saved_receipt_id uuid := input_receipt_id;
  saved_purchase_id uuid := input_purchase_id;
begin
  if not public.is_trip_member(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if coalesce(btrim(input_title), '') = ''
    or coalesce(input_category, '') not in ('food', 'equipment', 'supplies', 'lodging', 'activity', 'transport', 'other', 'receipt')
    or coalesce(input_payment_status, '') not in ('unpaid', 'paid')
    or coalesce(input_allocation_method, '') not in ('equal_all', 'equal_selected', 'custom', 'personal') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if input_payer_id is not null and not exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id and user_id = input_payer_id and status = 'approved'
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if input_itinerary_item_id is not null and not exists (
    select 1 from public.itinerary_items
    where id = input_itinerary_item_id and trip_id = target_trip_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if input_purchase_id is not null and not exists (
    select 1 from public.purchases
    where id = input_purchase_id and trip_id = target_trip_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if input_receipt_id is not null and not exists (
    select 1 from public.receipts
    where id = input_receipt_id and trip_id = target_trip_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  base_total := case when input_payment_status = 'paid' then next_actual_amount else next_planned_amount end;

  if input_allocation_method = 'equal_all' then
    select array_agg(user_id order by user_id)
      into selected_ids
    from public.trip_members
    where trip_id = target_trip_id and status = 'approved';
  elsif input_allocation_method = 'equal_selected' then
    selected_ids := input_share_user_ids;
  elsif input_allocation_method = 'personal' then
    if input_payer_id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
    selected_ids := array[input_payer_id];
  else
    selected_ids := array(
      select key::uuid
      from jsonb_each(coalesce(input_share_amounts, '{}'::jsonb))
      order by key
    );
  end if;

  if selected_ids is null or cardinality(selected_ids) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (
    select 1 from unnest(selected_ids) ids(user_id)
    where not exists (
      select 1 from public.trip_members
      where trip_id = target_trip_id and trip_members.user_id = ids.user_id and status = 'approved'
    )
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if input_allocation_method = 'custom' then
    for candidate, candidate_amount in
      select key::uuid, greatest(coalesce(value, '0')::integer, 0)
      from jsonb_each_text(coalesce(input_share_amounts, '{}'::jsonb))
    loop
      share_total := share_total + candidate_amount;
    end loop;
    if share_total <> base_total then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;

  if target_expense_id is null then
    insert into public.expenses (
      trip_id, receipt_id, purchase_id, itinerary_item_id, title, category,
      planned_amount, amount, payer_id, payment_status, settlement_status,
      allocation_method, memo, created_by
    ) values (
      target_trip_id, saved_receipt_id, saved_purchase_id, input_itinerary_item_id,
      btrim(input_title), input_category, next_planned_amount, next_actual_amount,
      input_payer_id, input_payment_status, 'unsettled', input_allocation_method,
      coalesce(input_memo, ''), auth.uid()
    ) returning id, version into saved_expense_id, saved_version;
  else
    select version into current_version
    from public.expenses
    where id = target_expense_id and trip_id = target_trip_id
    for update;
    if not found then
      return jsonb_build_object('status', 'not_found');
    end if;
    if expected_version is not null and current_version <> expected_version then
      return jsonb_build_object('status', 'conflict');
    end if;
    update public.expenses
    set receipt_id = saved_receipt_id,
        purchase_id = saved_purchase_id,
        itinerary_item_id = input_itinerary_item_id,
        title = btrim(input_title),
        category = input_category,
        planned_amount = next_planned_amount,
        amount = next_actual_amount,
        payer_id = input_payer_id,
        payment_status = input_payment_status,
        settlement_status = 'unsettled',
        allocation_method = input_allocation_method,
        memo = coalesce(input_memo, '')
    where id = target_expense_id and trip_id = target_trip_id;
    saved_expense_id := target_expense_id;
    select version into saved_version from public.expenses where id = saved_expense_id;
    delete from public.expense_shares where expense_id = saved_expense_id;
  end if;

  if input_allocation_method in ('equal_all', 'equal_selected', 'personal') then
    share_count := cardinality(selected_ids);
    share_base := base_total / share_count;
    share_remainder := base_total % share_count;
    foreach candidate in array selected_ids loop
      share_index := share_index + 1;
      insert into public.expense_shares (expense_id, user_id, amount)
      values (saved_expense_id, candidate, share_base + case when share_index <= share_remainder then 1 else 0 end);
    end loop;
  else
    for candidate, candidate_amount in
      select key::uuid, greatest(coalesce(value, '0')::integer, 0)
      from jsonb_each_text(coalesce(input_share_amounts, '{}'::jsonb))
    loop
      insert into public.expense_shares (expense_id, user_id, amount)
      values (saved_expense_id, candidate, candidate_amount);
    end loop;
  end if;

  return jsonb_build_object('status', 'ok', 'id', saved_expense_id, 'version', saved_version);
end;
$$;

revoke all on function public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, uuid, text, uuid[], jsonb, text) from public;
grant execute on function public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, uuid, text, uuid[], jsonb, text) to authenticated;

-- レシート登録も統合費用の負担方法・行程リンクに対応させる。
create or replace function public.create_receipt_expense_with_shares(
  target_trip_id uuid,
  input_store_name text,
  input_purchased_on date,
  input_payer_id uuid,
  input_category text,
  input_memo text,
  input_items jsonb,
  input_itinerary_item_id uuid,
  input_allocation_method text,
  input_share_user_ids uuid[],
  input_share_amounts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_receipt_id uuid;
  item jsonb;
  total_amount integer := 0;
  expense_result jsonb;
begin
  if not public.is_trip_member(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if coalesce(btrim(input_store_name), '') = '' or jsonb_array_length(coalesce(input_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.receipts (trip_id, store_name, purchased_on, payer_id, memo, created_by)
  values (target_trip_id, btrim(input_store_name), input_purchased_on, input_payer_id, coalesce(input_memo, ''), auth.uid())
  returning id into new_receipt_id;

  for item in select * from jsonb_array_elements(input_items) loop
    insert into public.receipt_items (receipt_id, name, category, net_amount, tax_rate, tax_amount, gross_amount)
    values (
      new_receipt_id,
      coalesce(nullif(btrim(item->>'name'), ''), '明細'),
      coalesce(nullif(item->>'category', ''), 'other'),
      greatest(0, coalesce(nullif(item->>'net_amount', '')::integer, 0)),
      coalesce(nullif(item->>'tax_rate', '')::numeric, 0.10),
      greatest(0, coalesce(nullif(item->>'tax_amount', '')::integer, 0)),
      greatest(0, coalesce(nullif(item->>'gross_amount', '')::integer, 0))
    );
    total_amount := total_amount + greatest(0, coalesce(nullif(item->>'gross_amount', '')::integer, 0));
  end loop;

  expense_result := public.save_expense_with_shares(
    target_trip_id,
    null,
    null,
    btrim(input_store_name),
    coalesce(nullif(input_category, ''), 'receipt'),
    total_amount,
    total_amount,
    'paid',
    input_payer_id,
    input_itinerary_item_id,
    null,
    new_receipt_id,
    input_allocation_method,
    input_share_user_ids,
    input_share_amounts,
    coalesce(input_memo, '')
  );
  if expense_result->>'status' <> 'ok' then
    raise exception 'Unable to save receipt expense: %', expense_result->>'status';
  end if;

  return expense_result || jsonb_build_object('receipt_id', new_receipt_id);
end;
$$;

revoke all on function public.create_receipt_expense_with_shares(uuid, text, date, uuid, text, text, jsonb, uuid, text, uuid[], jsonb) from public;
grant execute on function public.create_receipt_expense_with_shares(uuid, text, date, uuid, text, text, jsonb, uuid, text, uuid[], jsonb) to authenticated;
