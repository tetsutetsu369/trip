-- Users must be able to resolve the configured trip before their membership
-- is approved. Return only the opaque trip id, not the trip row itself.
create or replace function public.get_trip_id_by_slug(target_slug text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id
  from public.trips
  where slug = target_slug
  limit 1;
$$;

revoke all on function public.get_trip_id_by_slug(text) from public;
grant execute on function public.get_trip_id_by_slug(text) to authenticated;
