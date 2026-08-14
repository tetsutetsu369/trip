import type { SupabaseClient, User } from "@supabase/supabase-js";

type MembershipStatus = "pending" | "approved" | "rejected" | "removed";

type TripMembership = {
  id: string;
  trip_id: string;
  user_id: string;
  role: "member" | "admin";
  status: MembershipStatus;
};

export async function ensureTripMembership(
  supabase: SupabaseClient,
  tripId: string,
  user: User,
) {
  const metadata = user.user_metadata ?? {};
  const lineUserId =
    metadata.provider_id ?? metadata.sub ?? metadata.user_id ?? null;
  const displayName =
    metadata.full_name ?? metadata.name ?? metadata.user_name ?? user.email ?? "参加者";
  const avatarUrl = metadata.avatar_url ?? metadata.picture ?? null;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      line_user_id: lineUserId,
      line_display_name: displayName,
      nickname: displayName,
      avatar_url: avatarUrl,
      email: user.email ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (profileError) throw profileError;

  const { data: existing, error: existingError } = await supabase
    .from("trip_members")
    .select("id, trip_id, user_id, role, status")
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .maybeSingle<TripMembership>();

  if (existingError) throw existingError;
  if (existing) {
    if (existing.status === "pending") {
      const { data: claimed, error: claimError } = await supabase.rpc("claim_initial_admin", {
        target_trip_id: tripId,
      });
      if (claimError) throw claimError;
      if (claimed) {
        return { ...existing, status: "approved", role: "admin" };
      }
    }
    return existing;
  }

  const { count: memberCount, error: countError } = await supabase
    .from("trip_members")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId);
  if (countError) throw countError;

  const initialAdminLineUserId = process.env.INITIAL_ADMIN_LINE_USER_ID;
  const isConfiguredInitialAdmin = Boolean(initialAdminLineUserId && lineUserId === initialAdminLineUserId);
  const isFirstMember = (memberCount ?? 0) === 0;
  const isInitialAdmin = isFirstMember || isConfiguredInitialAdmin;

  const { data: created, error: createError } = await supabase
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: user.id, status: isInitialAdmin ? "approved" : "pending", role: isInitialAdmin ? "admin" : "member", approved_at: isInitialAdmin ? new Date().toISOString() : null })
    .select("id, trip_id, user_id, role, status")
    .single<TripMembership>();

  if (createError) throw createError;
  return created;
}

export async function getTripIdBySlug(supabase: SupabaseClient, slug: string) {
  const { data, error } = await supabase.rpc("get_trip_id_by_slug", {
    target_slug: slug,
  });
  if (error) throw error;
  if (!data) throw new Error(`Trip not found: ${slug}`);
  return data as string;
}
