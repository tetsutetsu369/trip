create table public.trip_settings (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  budget jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

alter table public.trip_settings enable row level security;

create policy "members can read trip settings" on public.trip_settings
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can create trip settings" on public.trip_settings
  for insert to authenticated
  with check (public.is_trip_member(trip_id) and updated_by = auth.uid());
create policy "members can update trip settings" on public.trip_settings
  for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id) and updated_by = auth.uid());

create trigger trip_settings_set_updated_at
before update on public.trip_settings
for each row execute function public.set_updated_at();
