-- 費用登録を一本化し、旧レシート・購入品・レンタル構造を整理する。

drop function if exists public.delete_receipt_expense(uuid, integer);
drop function if exists public.create_receipt_expense(uuid, text, date, uuid, text, jsonb, uuid[]);
drop function if exists public.create_receipt_expense_with_shares(uuid, text, date, uuid, text, text, jsonb, uuid, text, uuid[], jsonb);
drop function if exists public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, uuid, text, uuid[], jsonb, text);

drop policy if exists "members can edit settlements" on public.settlements;
alter table public.settlements
  drop constraint if exists settlements_participants_distinct_check;

-- 支払い前の既存データに支払者が入っていた場合も、状態に合わせて未設定へ戻す。
update public.expenses
set payer_id = null,
    payer_participant_id = null
where payment_status = 'unpaid';

-- 明細単位の税情報と、同じ支払いに含まれる明細を識別するキーを費用へ集約する。
alter table public.expenses
  add column if not exists transaction_id uuid default gen_random_uuid(),
  add column if not exists merchant_name text not null default '',
  add column if not exists purchased_on date,
  add column if not exists net_amount integer not null default 0,
  add column if not exists tax_rate numeric(4,3) not null default 0,
  add column if not exists tax_amount integer not null default 0;

update public.expenses
set transaction_id = gen_random_uuid()
where transaction_id is null;

update public.expenses
set category = 'other'
where category = 'receipt';

alter table public.expenses
  alter column transaction_id set not null,
  add constraint expenses_net_amount_check check (net_amount >= 0),
  add constraint expenses_tax_rate_check check (tax_rate in (0, 0.08, 0.10)),
  add constraint expenses_tax_amount_check check (tax_amount >= 0),
  add constraint expenses_unpaid_without_payer_check check (payment_status <> 'unpaid' or payer_participant_id is null),
  add constraint expenses_paid_with_payer_check check (payment_status <> 'paid' or payer_participant_id is not null);

create index if not exists expenses_transaction_idx on public.expenses (transaction_id);

-- 参加者IDを正規キーにし、旧プロフィールID列を取り除く。
alter table public.expense_shares
  drop column if exists user_id;
alter table public.expense_shares
  alter column participant_id set not null;
drop index if exists public.expense_shares_expense_participant_idx;
create unique index expense_shares_expense_participant_idx
  on public.expense_shares (expense_id, participant_id);

alter table public.expenses
  drop column if exists payer_id,
  drop column if exists receipt_id,
  drop column if exists purchase_id;

alter table public.settlements
  drop column if exists from_user_id,
  drop column if exists to_user_id,
  alter column from_participant_id set not null,
  alter column to_participant_id set not null;

alter table public.settlements
  add constraint settlements_participants_distinct_check
  check (from_participant_id is distinct from to_participant_id);

-- 0021でexpensesへ移行済みの旧購入品設定を旅行設定から除去する。
update public.trip_settings
set budget = coalesce(budget, '{}'::jsonb) - array[
  'people', 'budgetCount', 'purchasePerBudget', 'purchasePerPerson', 'purchases',
  'cottage', 'adventure', 'kilometers', 'gasPrice', 'efficiency', 'parking', 'toll',
  'rentOn', 'rentQty'
]::text[];

-- 旧テーブルは本番データが0件、または全件がexpensesへ移行済みのため削除する。
drop table if exists public.receipt_items;
drop table if exists public.receipts;
drop table if exists public.purchases;
drop table if exists public.rentals;

create policy "members can edit settlements" on public.settlements
  for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (
    public.is_trip_member(trip_id)
    and exists (
      select 1
      from public.trip_participants participants
      where participants.id = settlements.from_participant_id
        and participants.trip_id = settlements.trip_id
    )
    and exists (
      select 1
      from public.trip_participants participants
      where participants.id = settlements.to_participant_id
        and participants.trip_id = settlements.trip_id
    )
  );

-- 参加者ID・税情報・支払い状態を一つの費用保存RPCで扱う。
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
  input_transaction_id uuid,
  input_merchant_name text,
  input_purchased_on date,
  input_net_amount integer,
  input_tax_rate numeric,
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
  current_transaction_id uuid;
  next_actual_amount integer := case when input_payment_status = 'paid' then greatest(coalesce(input_actual_amount, 0), 0) else 0 end;
  next_planned_amount integer := greatest(coalesce(input_planned_amount, 0), 0);
  next_net_amount integer := greatest(coalesce(input_net_amount, 0), 0);
  next_tax_rate numeric(4,3) := coalesce(input_tax_rate, 0.10);
  next_tax_amount integer;
  base_total integer;
  share_count integer := 0;
  share_base integer := 0;
  share_remainder integer := 0;
  share_index integer := 0;
  candidate uuid;
  raw_candidate uuid;
  candidate_amount integer;
  selected_ids uuid[];
  share_total integer := 0;
  resolved_payer_participant_id uuid;
  normalized_share_amounts jsonb := coalesce(input_share_amounts, '{}'::jsonb);
begin
  if not public.is_trip_member(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if coalesce(btrim(input_title), '') = ''
    or coalesce(input_category, '') not in ('food', 'equipment', 'supplies', 'lodging', 'activity', 'transport', 'other')
    or coalesce(input_payment_status, '') not in ('unpaid', 'paid')
    or coalesce(input_allocation_method, '') not in ('equal_all', 'equal_selected', 'custom', 'personal')
    or next_tax_rate not in (0, 0.08, 0.10) then
    return jsonb_build_object('status', 'invalid');
  end if;

  next_tax_amount := floor(next_net_amount * next_tax_rate)::integer;
  base_total := case when input_payment_status = 'paid' then next_actual_amount else next_planned_amount end;

  if input_payment_status = 'paid' then
    if input_payer_id is null then
      return jsonb_build_object('status', 'payer_required');
    end if;
    resolved_payer_participant_id := public.resolve_trip_participant_id(target_trip_id, input_payer_id);
    if resolved_payer_participant_id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
  else
    resolved_payer_participant_id := null;
    if input_allocation_method = 'personal' then
      return jsonb_build_object('status', 'personal_requires_paid');
    end if;
  end if;

  if input_itinerary_item_id is not null and not exists (
    select 1 from public.itinerary_items
    where id = input_itinerary_item_id and trip_id = target_trip_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if input_allocation_method = 'equal_all' then
    select array_agg(participants.id order by participants.id)
      into selected_ids
    from public.trip_participants participants
    where participants.trip_id = target_trip_id;
  elsif input_allocation_method = 'equal_selected' then
    if exists (
      select 1
      from unnest(coalesce(input_share_user_ids, '{}'::uuid[])) ids(candidate_id)
      where public.resolve_trip_participant_id(target_trip_id, ids.candidate_id) is null
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    selected_ids := array(
      select distinct public.resolve_trip_participant_id(target_trip_id, ids.candidate_id)
      from unnest(coalesce(input_share_user_ids, '{}'::uuid[])) ids(candidate_id)
      order by 1
    );
  elsif input_allocation_method = 'personal' then
    if resolved_payer_participant_id is null then
      return jsonb_build_object('status', 'payer_required');
    end if;
    selected_ids := array[resolved_payer_participant_id];
  else
    if jsonb_typeof(normalized_share_amounts) <> 'object' or jsonb_object_length(normalized_share_amounts) = 0 then
      return jsonb_build_object('status', 'invalid');
    end if;
    if exists (
      select 1
      from jsonb_object_keys(normalized_share_amounts) keys(candidate_key)
      where public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid) is null
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    selected_ids := array(
      select distinct public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid)
      from jsonb_object_keys(normalized_share_amounts) keys(candidate_key)
      order by 1
    );
  end if;

  if selected_ids is null or cardinality(selected_ids) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  if jsonb_typeof(normalized_share_amounts) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;

  if jsonb_object_length(normalized_share_amounts) > 0 then
    if (
      select count(distinct public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid))
      from jsonb_object_keys(normalized_share_amounts) keys(candidate_key)
    ) <> cardinality(selected_ids) then
      return jsonb_build_object('status', 'invalid');
    end if;
    if exists (
      select 1
      from unnest(selected_ids) ids(participant_id)
      where not exists (
        select 1
        from jsonb_object_keys(normalized_share_amounts) keys(candidate_key)
        where public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid) = ids.participant_id
      )
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    for raw_candidate, candidate_amount in
      select key::uuid, greatest(coalesce(nullif(value, '')::integer, 0), 0)
      from jsonb_each_text(normalized_share_amounts)
    loop
      share_total := share_total + candidate_amount;
    end loop;
    if share_total <> base_total then
      return jsonb_build_object('status', 'invalid');
    end if;
  elsif input_allocation_method = 'custom' then
    return jsonb_build_object('status', 'invalid');
  end if;

  if target_expense_id is null then
    insert into public.expenses (
      trip_id, transaction_id, merchant_name, purchased_on, itinerary_item_id,
      title, category, net_amount, tax_rate, tax_amount, planned_amount, amount,
      payer_participant_id, payment_status, settlement_status, allocation_method,
      memo, created_by
    ) values (
      target_trip_id, coalesce(input_transaction_id, gen_random_uuid()), coalesce(btrim(input_merchant_name), ''), input_purchased_on,
      input_itinerary_item_id, btrim(input_title), input_category, next_net_amount, next_tax_rate, next_tax_amount,
      next_planned_amount, next_actual_amount, resolved_payer_participant_id, input_payment_status, 'unsettled',
      input_allocation_method, coalesce(input_memo, ''), auth.uid()
    ) returning id, version into saved_expense_id, saved_version;
  else
    select version, transaction_id
      into current_version, current_transaction_id
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
    set transaction_id = coalesce(input_transaction_id, current_transaction_id),
        merchant_name = coalesce(btrim(input_merchant_name), ''),
        purchased_on = input_purchased_on,
        itinerary_item_id = input_itinerary_item_id,
        title = btrim(input_title),
        category = input_category,
        net_amount = next_net_amount,
        tax_rate = next_tax_rate,
        tax_amount = next_tax_amount,
        planned_amount = next_planned_amount,
        amount = next_actual_amount,
        payer_participant_id = resolved_payer_participant_id,
        payment_status = input_payment_status,
        settlement_status = 'unsettled',
        allocation_method = input_allocation_method,
        memo = coalesce(input_memo, '')
    where id = target_expense_id and trip_id = target_trip_id;
    saved_expense_id := target_expense_id;
    select version into saved_version from public.expenses where id = saved_expense_id;
    delete from public.expense_shares where expense_id = saved_expense_id;
  end if;

  if jsonb_object_length(normalized_share_amounts) > 0 then
    for raw_candidate, candidate_amount in
      select key::uuid, greatest(coalesce(nullif(value, '')::integer, 0), 0)
      from jsonb_each_text(normalized_share_amounts)
    loop
      candidate := public.resolve_trip_participant_id(target_trip_id, raw_candidate);
      insert into public.expense_shares (expense_id, participant_id, amount)
      values (saved_expense_id, candidate, candidate_amount);
    end loop;
  else
    share_count := cardinality(selected_ids);
    share_base := base_total / share_count;
    share_remainder := base_total % share_count;
    foreach candidate in array selected_ids loop
      share_index := share_index + 1;
      insert into public.expense_shares (expense_id, participant_id, amount)
      values (saved_expense_id, candidate, share_base + case when share_index <= share_remainder then 1 else 0 end);
    end loop;
  end if;

  return jsonb_build_object('status', 'ok', 'id', saved_expense_id, 'version', saved_version);
end;
$$;

revoke all on function public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, text, date, integer, numeric, text, uuid[], jsonb, text) from public;
grant execute on function public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, text, date, integer, numeric, text, uuid[], jsonb, text) to authenticated;

-- 複数明細を同じ支払いとして一括保存する。各明細のshare_amountsは、画面側で
-- 支払い全体の端数を調整した値を渡すため、明細ごとの丸め誤差を累積させない。
create or replace function public.create_expense_batch_with_shares(
  target_trip_id uuid,
  input_transaction_id uuid,
  input_merchant_name text,
  input_purchased_on date,
  input_itinerary_item_id uuid,
  input_payment_status text,
  input_payer_id uuid,
  input_allocation_method text,
  input_share_user_ids uuid[],
  input_items jsonb,
  input_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_transaction_id uuid := coalesce(input_transaction_id, gen_random_uuid());
  item jsonb;
  item_result jsonb;
  saved_ids jsonb := '[]'::jsonb;
begin
  if not public.is_trip_member(target_trip_id)
    or jsonb_typeof(coalesce(input_items, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(input_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  for item in select * from jsonb_array_elements(input_items) loop
    item_result := public.save_expense_with_shares(
      target_trip_id,
      null,
      null,
      coalesce(nullif(btrim(item->>'title'), ''), '明細'),
      coalesce(nullif(item->>'category', ''), 'other'),
      greatest(coalesce(nullif(item->>'planned_amount', '')::integer, 0), 0),
      greatest(coalesce(nullif(item->>'actual_amount', '')::integer, 0), 0),
      input_payment_status,
      input_payer_id,
      input_itinerary_item_id,
      batch_transaction_id,
      input_merchant_name,
      input_purchased_on,
      greatest(coalesce(nullif(item->>'net_amount', '')::integer, 0), 0),
      coalesce(nullif(item->>'tax_rate', '')::numeric, 0.10),
      input_allocation_method,
      input_share_user_ids,
      coalesce(item->'share_amounts', '{}'::jsonb),
      coalesce(nullif(item->>'memo', ''), input_memo)
    );
    if item_result->>'status' <> 'ok' then
      raise exception 'Unable to save expense item: %', item_result->>'status';
    end if;
    saved_ids := saved_ids || jsonb_build_array(item_result->'id');
  end loop;

  return jsonb_build_object('status', 'ok', 'transaction_id', batch_transaction_id, 'ids', saved_ids);
end;
$$;

revoke all on function public.create_expense_batch_with_shares(uuid, uuid, text, date, uuid, text, uuid, text, uuid[], jsonb, text) from public;
grant execute on function public.create_expense_batch_with_shares(uuid, uuid, text, date, uuid, text, uuid, text, uuid[], jsonb, text) to authenticated;
