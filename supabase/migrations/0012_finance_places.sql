-- Finance phase: keep shopping plans separate from actual expenses and settlements.
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  from_user_id uuid not null references public.profiles(id) on delete restrict,
  to_user_id uuid not null references public.profiles(id) on delete restrict,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  memo text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (from_user_id <> to_user_id)
);

create table public.trip_places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null default 'other' check (category in ('lodging', 'food', 'activity', 'shopping', 'transit', 'other')),
  address text not null default '',
  website_url text not null default '',
  map_url text not null default '',
  phone text not null default '',
  opening_hours text not null default '',
  memo text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (trip_id, name)
);

alter table public.itinerary_items
  add column place_id uuid references public.trip_places(id) on delete restrict;

create index settlements_trip_status_idx on public.settlements (trip_id, status, created_at desc);
create index trip_places_trip_category_idx on public.trip_places (trip_id, category, name);
create index itinerary_items_place_idx on public.itinerary_items (place_id);

create trigger settlements_set_updated_at before update on public.settlements for each row execute function public.set_updated_at();
create trigger trip_places_set_updated_at before update on public.trip_places for each row execute function public.set_updated_at();
create trigger settlements_bump_version before update on public.settlements for each row execute function public.bump_version();
create trigger trip_places_bump_version before update on public.trip_places for each row execute function public.bump_version();
create trigger settlements_log_change after insert or update or delete on public.settlements for each row execute function public.log_change();
create trigger trip_places_log_change after insert or update or delete on public.trip_places for each row execute function public.log_change();

alter table public.settlements enable row level security;
alter table public.trip_places enable row level security;

create policy "members can read settlements" on public.settlements
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit settlements" on public.settlements
  for all to authenticated using (public.is_trip_member(trip_id))
  with check (
    public.is_trip_member(trip_id)
    and exists (select 1 from public.trip_members where trip_id = settlements.trip_id and user_id = settlements.from_user_id and status = 'approved')
    and exists (select 1 from public.trip_members where trip_id = settlements.trip_id and user_id = settlements.to_user_id and status = 'approved')
  );

create policy "members can read trip places" on public.trip_places
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit trip places" on public.trip_places
  for all to authenticated using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- Convert the existing free-text itinerary places into reusable place records.
insert into public.trip_places (trip_id, name, category)
select distinct
  trip_id,
  btrim(place),
  case
    when btrim(place) ilike any (array['%宿%', '%コテージ%', '%キャンプ%']) then 'lodging'
    when btrim(place) ilike any (array['%食%', '%市場%', '%BBQ%', '%レストラン%']) then 'food'
    when btrim(place) ilike any (array['%IC%', '%駅%', '%駐車%', '%フジグラン%']) then 'transit'
    when btrim(place) ilike any (array['%アドベンチャー%', '%遊%', '%観光%']) then 'activity'
    else 'other'
  end
from public.itinerary_items
where char_length(btrim(place)) > 0
on conflict (trip_id, name) do nothing;

update public.itinerary_items items
set place_id = places.id
from public.trip_places places
where items.place_id is null
  and char_length(btrim(items.place)) > 0
  and places.trip_id = items.trip_id
  and places.name = btrim(items.place);

-- Convert the old shopping-list JSON into the normalized purchases table once.
insert into public.purchases (
  trip_id, name, category, planned_amount, purchased_amount, is_purchased, memo
)
select
  settings.trip_id,
  coalesce(nullif(item->>'name', ''), '名称未設定'),
  case item->>'category'
    when '食費' then 'food'
    when '備品' then 'equipment'
    when '消耗品' then 'supplies'
    else 'other'
  end,
  greatest(0, coalesce(nullif(item->>'cost', '')::integer, 0)),
  case when coalesce((item->>'bought')::boolean, false)
    then greatest(0, coalesce(nullif(item->>'cost', '')::integer, 0)) else 0 end,
  coalesce((item->>'bought')::boolean, false),
  coalesce(item->>'note', '')
from public.trip_settings settings
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(settings.budget->'purchases') = 'array' then settings.budget->'purchases' else '[]'::jsonb end
) item
where not exists (select 1 from public.purchases existing where existing.trip_id = settings.trip_id);

-- Preserve the old fixed-cost amounts as expenses. The payer and shares can be
-- filled in from the new finance screen because the old JSON did not contain
-- reliable payer information.
insert into public.expenses (trip_id, title, category, amount, payment_status, settlement_status, memo)
select settings.trip_id, '宿泊費', 'lodging', greatest(0, coalesce(nullif(settings.budget->>'cottage', '')::integer, 0)), 'paid', 'unsettled', '旧予算JSONから移行'
from public.trip_settings settings
where coalesce(nullif(settings.budget->>'cottage', '')::integer, 0) > 0
  and not exists (select 1 from public.expenses expense where expense.trip_id = settings.trip_id and expense.title = '宿泊費');

insert into public.expenses (trip_id, title, category, amount, payment_status, settlement_status, memo)
select settings.trip_id, 'アクティビティ費', 'activity', greatest(0, coalesce(nullif(settings.budget->>'adventure', '')::integer, 0)), 'paid', 'unsettled', '旧予算JSONから移行'
from public.trip_settings settings
where coalesce(nullif(settings.budget->>'adventure', '')::integer, 0) > 0
  and not exists (select 1 from public.expenses expense where expense.trip_id = settings.trip_id and expense.title = 'アクティビティ費');

-- Save receipt + line items + equally split shares in one transaction.
create or replace function public.create_receipt_expense(
  target_trip_id uuid,
  input_store_name text,
  input_purchased_on date,
  input_payer_id uuid,
  input_memo text,
  input_items jsonb,
  input_share_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_receipt_id uuid;
  new_expense_id uuid;
  item jsonb;
  total_amount integer := 0;
  share_count integer := 0;
  share_base integer := 0;
  share_remainder integer := 0;
  share_index integer := 0;
  candidate uuid;
begin
  if not public.is_trip_member(target_trip_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if coalesce(btrim(input_store_name), '') = '' or jsonb_array_length(coalesce(input_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if input_payer_id is not null and not exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id and user_id = input_payer_id and status = 'approved'
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if input_share_user_ids is null or cardinality(input_share_user_ids) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (
    select 1 from unnest(input_share_user_ids) ids(user_id)
    where not exists (
      select 1 from public.trip_members
      where trip_id = target_trip_id and trip_members.user_id = ids.user_id and status = 'approved'
    )
  ) then
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

  insert into public.expenses (trip_id, receipt_id, title, category, amount, payer_id, payment_status, settlement_status, memo, created_by)
  values (target_trip_id, new_receipt_id, btrim(input_store_name), 'receipt', total_amount, input_payer_id, 'paid', 'unsettled', coalesce(input_memo, ''), auth.uid())
  returning id into new_expense_id;

  share_count := cardinality(input_share_user_ids);
  share_base := total_amount / share_count;
  share_remainder := total_amount % share_count;
  foreach candidate in array input_share_user_ids loop
    share_index := share_index + 1;
    insert into public.expense_shares (expense_id, user_id, amount)
    values (new_expense_id, candidate, share_base + case when share_index <= share_remainder then 1 else 0 end);
  end loop;

  return jsonb_build_object('status', 'ok', 'receipt_id', new_receipt_id, 'expense_id', new_expense_id);
end;
$$;

revoke all on function public.create_receipt_expense(uuid, text, date, uuid, text, jsonb, uuid[]) from public;
grant execute on function public.create_receipt_expense(uuid, text, date, uuid, text, jsonb, uuid[]) to authenticated;
