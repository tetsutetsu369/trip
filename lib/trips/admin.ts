import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAdminContext(supabase: SupabaseClient, tripSlug: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, slug, name")
    .eq("slug", tripSlug)
    .single<{ id: string; slug: string; name: string }>();
  if (tripError || !trip) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("trip_members")
    .select("id, role, status")
    .eq("trip_id", trip.id)
    .eq("user_id", userData.user.id)
    .maybeSingle<{ id: string; role: string; status: string }>();

  if (membershipError || membership?.status !== "approved" || membership.role !== "admin") {
    return null;
  }

  return { user: userData.user, trip, membership };
}

