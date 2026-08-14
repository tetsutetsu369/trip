-- A participant can exist before they have logged in.  Once an administrator
-- links the participant to a profile, the same participant id is retained.
create table public.trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete restrict,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  avatar_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (trip_id, display_name),
  unique (trip_id, profile_id)
);

create index trip_participants_trip_idx on public.trip_participants(trip_id);
create trigger trip_participants_set_updated_at before update on public.trip_participants for each row execute function public.set_updated_at();
alter table public.trip_participants enable row level security;

create policy "members can read trip participants" on public.trip_participants
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "admins can manage trip participants" on public.trip_participants
  for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

insert into public.trip_participants (trip_id, profile_id, display_name, avatar_color)
select members.trip_id, profiles.id, coalesce(nullif(profiles.nickname, ''), nullif(profiles.line_display_name, ''), '参加者'), profiles.avatar_color
from public.trip_members members
join public.profiles on profiles.id = members.user_id
where members.status = 'approved'
on conflict (trip_id, profile_id) do nothing;

alter table public.itinerary_assignees add column participant_id uuid references public.trip_participants(id) on delete restrict;
update public.itinerary_assignees assignments
set participant_id = participants.id
from public.trip_participants participants
where participants.profile_id = assignments.user_id;
alter table public.itinerary_assignees alter column participant_id set not null;
alter table public.itinerary_assignees drop constraint itinerary_assignees_pkey;
alter table public.itinerary_assignees drop column user_id;
alter table public.itinerary_assignees add primary key (itinerary_item_id, participant_id);
