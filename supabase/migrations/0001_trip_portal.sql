create extension if not exists pgcrypto;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  start_date date,
  end_date date,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  line_user_id text unique,
  line_display_name text not null default '',
  nickname text not null default '',
  avatar_url text,
  avatar_color text,
  email text,
  bio text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null default 'member' check (role in ('member', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  approved_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (trip_id, user_id)
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  event_date date,
  event_time time,
  place text not null default '',
  title text not null,
  notes text not null default '',
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  store_name text not null default '',
  purchased_on date,
  payer_id uuid references public.profiles(id) on delete set null,
  memo text not null default '',
  tax_rounding text not null default 'floor' check (tax_rounding in ('floor', 'round', 'ceil')),
  tax_adjustment integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  name text not null,
  category text not null default 'other',
  net_amount integer not null default 0 check (net_amount >= 0),
  tax_rate numeric(4,3) not null default 0.10 check (tax_rate in (0, 0.08, 0.10)),
  tax_amount integer not null default 0 check (tax_amount >= 0),
  gross_amount integer not null default 0 check (gross_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  receipt_id uuid references public.receipts(id) on delete set null,
  title text not null,
  category text not null default 'other',
  amount integer not null default 0 check (amount >= 0),
  payer_id uuid references public.profiles(id) on delete set null,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  settlement_status text not null default 'unsettled' check (settlement_status in ('unsettled', 'settled')),
  memo text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount integer not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (expense_id, user_id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  name text not null,
  category text not null default 'other',
  planned_amount integer not null default 0 check (planned_amount >= 0),
  purchased_amount integer not null default 0 check (purchased_amount >= 0),
  is_purchased boolean not null default false,
  assignee_id uuid references public.profiles(id) on delete set null,
  memo text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  name text not null,
  unit_amount integer not null default 0 check (unit_amount >= 0),
  quantity integer not null default 1 check (quantity >= 0),
  is_used boolean not null default false,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  name text not null,
  assignee_id uuid references public.profiles(id) on delete set null,
  is_ready boolean not null default false,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.shared_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  title text not null default '',
  body text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.change_logs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'delete', 'restore')),
  changed_fields jsonb not null default '{}'::jsonb,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index trip_members_trip_status_idx on public.trip_members (trip_id, status);
create index itinerary_items_trip_order_idx on public.itinerary_items (trip_id, sort_order, event_date, event_time);
create index receipts_trip_idx on public.receipts (trip_id, purchased_on);
create index expenses_trip_idx on public.expenses (trip_id, created_at);
create index purchases_trip_idx on public.purchases (trip_id, is_purchased);
create index packing_items_trip_idx on public.packing_items (trip_id, is_ready);
create index change_logs_trip_idx on public.change_logs (trip_id, created_at desc);

insert into public.trips (slug, name, description, start_date, end_date, theme)
values (
  'shikoku-saburo-bbq-2026',
  '四国三郎の郷 BBQ旅',
  '徳島と高知をめぐる、1泊2日のキャンプとBBQの旅。',
  '2026-09-04',
  '2026-09-05',
  '{"siteKey":"shikoku-saburo-bbq-2026"}'::jsonb
)
on conflict (slug) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_set_updated_at before update on public.trips for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger trip_members_set_updated_at before update on public.trip_members for each row execute function public.set_updated_at();
create trigger itinerary_items_set_updated_at before update on public.itinerary_items for each row execute function public.set_updated_at();
create trigger receipts_set_updated_at before update on public.receipts for each row execute function public.set_updated_at();
create trigger receipt_items_set_updated_at before update on public.receipt_items for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses for each row execute function public.set_updated_at();
create trigger expense_shares_set_updated_at before update on public.expense_shares for each row execute function public.set_updated_at();
create trigger purchases_set_updated_at before update on public.purchases for each row execute function public.set_updated_at();
create trigger rentals_set_updated_at before update on public.rentals for each row execute function public.set_updated_at();
create trigger packing_items_set_updated_at before update on public.packing_items for each row execute function public.set_updated_at();
create trigger shared_notes_set_updated_at before update on public.shared_notes for each row execute function public.set_updated_at();

create or replace function public.is_trip_member(target_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id
      and user_id = auth.uid()
      and status = 'approved'
  );
$$;

create or replace function public.is_trip_admin(target_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id
      and user_id = auth.uid()
      and status = 'approved'
      and role = 'admin'
  );
$$;

alter table public.trips enable row level security;
alter table public.profiles enable row level security;
alter table public.trip_members enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.purchases enable row level security;
alter table public.rentals enable row level security;
alter table public.packing_items enable row level security;
alter table public.shared_notes enable row level security;
alter table public.change_logs enable row level security;

create policy "approved members can read trips" on public.trips
  for select to authenticated using (public.is_trip_member(id));
create policy "admins can update trips" on public.trips
  for update to authenticated using (public.is_trip_admin(id)) with check (public.is_trip_admin(id));

create policy "users can read profiles in their trips" on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from public.trip_members viewer
      join public.trip_members target on target.trip_id = viewer.trip_id
      where viewer.user_id = auth.uid() and viewer.status = 'approved'
        and target.user_id = profiles.id and target.status = 'approved'
    )
  );
create policy "users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "users can create their own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy "members can read trip memberships" on public.trip_members
  for select to authenticated using (public.is_trip_member(trip_id) or user_id = auth.uid());
create policy "users can request membership" on public.trip_members
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy "admins can manage memberships" on public.trip_members
  for update to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

create policy "members can read itinerary" on public.itinerary_items
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit itinerary" on public.itinerary_items
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read receipts" on public.receipts
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit receipts" on public.receipts
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read receipt items" on public.receipt_items
  for select to authenticated using (exists (select 1 from public.receipts where id = receipt_id and public.is_trip_member(trip_id)));
create policy "members can edit receipt items" on public.receipt_items
  for all to authenticated using (exists (select 1 from public.receipts where id = receipt_id and public.is_trip_member(trip_id)))
  with check (exists (select 1 from public.receipts where id = receipt_id and public.is_trip_member(trip_id)));

create policy "members can read expenses" on public.expenses
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit expenses" on public.expenses
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read expense shares" on public.expense_shares
  for select to authenticated using (exists (select 1 from public.expenses where id = expense_id and public.is_trip_member(trip_id)));
create policy "members can edit expense shares" on public.expense_shares
  for all to authenticated using (exists (select 1 from public.expenses where id = expense_id and public.is_trip_member(trip_id)))
  with check (exists (select 1 from public.expenses where id = expense_id and public.is_trip_member(trip_id)));

create policy "members can read purchases" on public.purchases
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit purchases" on public.purchases
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read rentals" on public.rentals
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit rentals" on public.rentals
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read packing" on public.packing_items
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit packing" on public.packing_items
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read notes" on public.shared_notes
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can edit notes" on public.shared_notes
  for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

create policy "members can read change logs" on public.change_logs
  for select to authenticated using (public.is_trip_member(trip_id));
