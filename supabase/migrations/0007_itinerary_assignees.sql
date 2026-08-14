create table public.itinerary_assignees (
  itinerary_item_id uuid not null references public.itinerary_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (itinerary_item_id, user_id)
);

create index itinerary_assignees_user_idx on public.itinerary_assignees(user_id);

alter table public.itinerary_assignees enable row level security;

create policy "members can read itinerary assignees" on public.itinerary_assignees
  for select to authenticated using (
    exists (select 1 from public.itinerary_items where id = itinerary_item_id and public.is_trip_member(trip_id))
  );

create policy "members can add itinerary assignees" on public.itinerary_assignees
  for insert to authenticated with check (
    exists (select 1 from public.itinerary_items where id = itinerary_item_id and public.is_trip_member(trip_id))
  );

create policy "members can remove itinerary assignees" on public.itinerary_assignees
  for delete to authenticated using (
    exists (select 1 from public.itinerary_items where id = itinerary_item_id and public.is_trip_member(trip_id))
  );
