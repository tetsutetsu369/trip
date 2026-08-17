-- 仮登録の旅行参加者を、費用・負担額・精算の当事者として扱えるようにする。
-- 既存の profile ID 列は互換用に残し、participant ID を正規の表示・保存キーとして追加する。

alter table public.receipts
  add column if not exists payer_participant_id uuid references public.trip_participants(id) on delete set null;

alter table public.expenses
  add column if not exists payer_participant_id uuid references public.trip_participants(id) on delete set null;

alter table public.expense_shares
  add column if not exists participant_id uuid references public.trip_participants(id) on delete restrict;

alter table public.expense_shares
  alter column user_id drop not null;

alter table public.settlements
  add column if not exists from_participant_id uuid references public.trip_participants(id) on delete restrict,
  add column if not exists to_participant_id uuid references public.trip_participants(id) on delete restrict;

alter table public.settlements
  alter column from_user_id drop not null,
  alter column to_user_id drop not null;

-- 既存のプロフィール紐づきデータを参加者IDへ移行する。
update public.receipts receipts
set payer_participant_id = participants.id
from public.trip_participants participants
where receipts.payer_participant_id is null
  and participants.trip_id = receipts.trip_id
  and participants.profile_id = receipts.payer_id;

update public.expenses expenses
set payer_participant_id = participants.id
from public.trip_participants participants
where expenses.payer_participant_id is null
  and participants.trip_id = expenses.trip_id
  and participants.profile_id = expenses.payer_id;

update public.expense_shares shares
set participant_id = participants.id
from public.expenses expenses, public.trip_participants participants
where shares.participant_id is null
  and expenses.id = shares.expense_id
  and participants.trip_id = expenses.trip_id
  and participants.profile_id = shares.user_id;

update public.settlements settlements
set from_participant_id = participants.id
from public.trip_participants participants
where settlements.from_participant_id is null
  and participants.trip_id = settlements.trip_id
  and participants.profile_id = settlements.from_user_id;

update public.settlements settlements
set to_participant_id = participants.id
from public.trip_participants participants
where settlements.to_participant_id is null
  and participants.trip_id = settlements.trip_id
  and participants.profile_id = settlements.to_user_id;

create index if not exists receipts_payer_participant_idx on public.receipts (payer_participant_id);
create index if not exists expenses_payer_participant_idx on public.expenses (payer_participant_id);
create index if not exists expense_shares_participant_idx on public.expense_shares (participant_id);
create unique index if not exists expense_shares_expense_participant_idx
  on public.expense_shares (expense_id, participant_id)
  where participant_id is not null;
create index if not exists settlements_participant_idx
  on public.settlements (from_participant_id, to_participant_id);

alter table public.settlements
  drop constraint if exists settlements_participants_distinct_check;

alter table public.settlements
  add constraint settlements_participants_distinct_check
  check (coalesce(from_participant_id, from_user_id) is distinct from coalesce(to_participant_id, to_user_id));

-- RPCへプロフィールIDまたは参加者IDを渡しても、同じ旅行の参加者IDへ解決する。
create or replace function public.resolve_trip_participant_id(
  target_trip_id uuid,
  candidate_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select participants.id
  from public.trip_participants participants
  where participants.trip_id = target_trip_id
    and (participants.id = candidate_id or participants.profile_id = candidate_id)
  order by (participants.id = candidate_id) desc
  limit 1;
$$;

revoke all on function public.resolve_trip_participant_id(uuid, uuid) from public;
grant execute on function public.resolve_trip_participant_id(uuid, uuid) to authenticated;

-- 仮登録参加者を含む当事者だけが精算を作成・更新できるようにする。
drop policy if exists "members can edit settlements" on public.settlements;

create policy "members can edit settlements" on public.settlements
  for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (
    public.is_trip_member(trip_id)
    and (
      (from_participant_id is not null and exists (
        select 1
        from public.trip_participants participants
        where participants.id = settlements.from_participant_id
          and participants.trip_id = settlements.trip_id
      ))
      or (from_participant_id is null and exists (
        select 1
        from public.trip_participants participants
        where participants.profile_id = settlements.from_user_id
          and participants.trip_id = settlements.trip_id
      ))
    )
    and (
      (to_participant_id is not null and exists (
        select 1
        from public.trip_participants participants
        where participants.id = settlements.to_participant_id
          and participants.trip_id = settlements.trip_id
      ))
      or (to_participant_id is null and exists (
        select 1
        from public.trip_participants participants
        where participants.profile_id = settlements.to_user_id
          and participants.trip_id = settlements.trip_id
      ))
    )
  );

-- 費用と負担額を、仮登録参加者にも対応させる。
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
  raw_candidate uuid;
  candidate_profile_id uuid;
  candidate_amount integer;
  selected_ids uuid[];
  share_total integer := 0;
  saved_receipt_id uuid := input_receipt_id;
  saved_purchase_id uuid := input_purchase_id;
  resolved_payer_participant_id uuid;
  resolved_payer_id uuid;
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

  if input_payer_id is not null then
    resolved_payer_participant_id := public.resolve_trip_participant_id(target_trip_id, input_payer_id);
    if resolved_payer_participant_id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
    select participants.profile_id
      into resolved_payer_id
    from public.trip_participants participants
    where participants.id = resolved_payer_participant_id
      and participants.trip_id = target_trip_id;
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
      return jsonb_build_object('status', 'invalid');
    end if;
    selected_ids := array[resolved_payer_participant_id];
  else
    if jsonb_typeof(coalesce(input_share_amounts, '{}'::jsonb)) <> 'object' then
      return jsonb_build_object('status', 'invalid');
    end if;
    if exists (
      select 1
      from jsonb_object_keys(coalesce(input_share_amounts, '{}'::jsonb)) keys(candidate_key)
      where public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid) is null
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    if (
      select count(*) from jsonb_object_keys(coalesce(input_share_amounts, '{}'::jsonb))
    ) <> (
      select count(distinct public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid))
      from jsonb_object_keys(coalesce(input_share_amounts, '{}'::jsonb)) keys(candidate_key)
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    selected_ids := array(
      select distinct public.resolve_trip_participant_id(target_trip_id, keys.candidate_key::uuid)
      from jsonb_object_keys(coalesce(input_share_amounts, '{}'::jsonb)) keys(candidate_key)
      order by 1
    );
  end if;

  if selected_ids is null or cardinality(selected_ids) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  if input_allocation_method = 'custom' then
    for raw_candidate, candidate_amount in
      select key::uuid, greatest(coalesce(nullif(value, '')::integer, 0), 0)
      from jsonb_each_text(coalesce(input_share_amounts, '{}'::jsonb))
    loop
      candidate := public.resolve_trip_participant_id(target_trip_id, raw_candidate);
      share_total := share_total + candidate_amount;
    end loop;
    if share_total <> base_total then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;

  if target_expense_id is null then
    insert into public.expenses (
      trip_id, receipt_id, purchase_id, itinerary_item_id, title, category,
      planned_amount, amount, payer_id, payer_participant_id, payment_status, settlement_status,
      allocation_method, memo, created_by
    ) values (
      target_trip_id, saved_receipt_id, saved_purchase_id, input_itinerary_item_id,
      btrim(input_title), input_category, next_planned_amount, next_actual_amount,
      resolved_payer_id, resolved_payer_participant_id, input_payment_status, 'unsettled',
      input_allocation_method, coalesce(input_memo, ''), auth.uid()
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
        payer_id = resolved_payer_id,
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

  if input_allocation_method in ('equal_all', 'equal_selected', 'personal') then
    share_count := cardinality(selected_ids);
    share_base := base_total / share_count;
    share_remainder := base_total % share_count;

    foreach candidate in array selected_ids loop
      share_index := share_index + 1;
      select participants.profile_id
        into candidate_profile_id
      from public.trip_participants participants
      where participants.id = candidate
        and participants.trip_id = target_trip_id;

      insert into public.expense_shares (expense_id, participant_id, user_id, amount)
      values (
        saved_expense_id,
        candidate,
        candidate_profile_id,
        share_base + case when share_index <= share_remainder then 1 else 0 end
      );
    end loop;
  else
    for raw_candidate, candidate_amount in
      select key::uuid, greatest(coalesce(nullif(value, '')::integer, 0), 0)
      from jsonb_each_text(coalesce(input_share_amounts, '{}'::jsonb))
    loop
      candidate := public.resolve_trip_participant_id(target_trip_id, raw_candidate);
      select participants.profile_id
        into candidate_profile_id
      from public.trip_participants participants
      where participants.id = candidate
        and participants.trip_id = target_trip_id;

      insert into public.expense_shares (expense_id, participant_id, user_id, amount)
      values (saved_expense_id, candidate, candidate_profile_id, candidate_amount);
    end loop;
  end if;

  return jsonb_build_object('status', 'ok', 'id', saved_expense_id, 'version', saved_version);
end;
$$;

revoke all on function public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, uuid, text, uuid[], jsonb, text) from public;
grant execute on function public.save_expense_with_shares(uuid, uuid, integer, text, text, integer, integer, text, uuid, uuid, uuid, uuid, text, uuid[], jsonb, text) to authenticated;

-- レシート登録も仮登録参加者に対応させる。
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
  resolved_payer_participant_id uuid;
  resolved_payer_id uuid;
begin
  if not public.is_trip_member(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if coalesce(btrim(input_store_name), '') = '' or jsonb_array_length(coalesce(input_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  if input_payer_id is not null then
    resolved_payer_participant_id := public.resolve_trip_participant_id(target_trip_id, input_payer_id);
    if resolved_payer_participant_id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
    select participants.profile_id
      into resolved_payer_id
    from public.trip_participants participants
    where participants.id = resolved_payer_participant_id
      and participants.trip_id = target_trip_id;
  end if;

  insert into public.receipts (
    trip_id, store_name, purchased_on, payer_id, payer_participant_id, memo, created_by
  )
  values (
    target_trip_id, btrim(input_store_name), input_purchased_on,
    resolved_payer_id, resolved_payer_participant_id, coalesce(input_memo, ''), auth.uid()
  )
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
