import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTripIdBySlug } from "@/lib/trips/membership";
import { getTripSiteConfig } from "@/lib/trips/site-config";

export async function getSharedTripContext(tripSlug: string, nextPath: string) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  try {
    const tripId = await getTripIdBySlug(supabase, tripSlug);
    const { data: membership, error } = await supabase.from("trip_members").select("status,role").eq("trip_id", tripId).eq("user_id", userData.user.id).maybeSingle<{ status: string; role: string }>();
    if (error) throw error;
    if (membership?.status !== "approved") redirect(`/pending?trip=${tripSlug}`);
    const [participantsResult, profileResult] = await Promise.all([
      supabase.from("trip_participants").select("id,display_name,avatar_color").eq("trip_id", tripId).order("created_at"),
      supabase.from("profiles").select("avatar_url").eq("id", userData.user.id).maybeSingle<{ avatar_url: string | null }>(),
    ]);
    const { data: participants, error: participantsError } = participantsResult;
    if (participantsError) throw participantsError;
    const site = getTripSiteConfig(tripSlug);
    if (!site) throw new Error("Trip site configuration not found");
    return { tripId, tripSlug, userId: userData.user.id, tripDates: { start: site.startDate, end: site.endDate }, participants: participants ?? [], isAdmin: membership.role === "admin", avatarUrl: profileResult.data?.avatar_url ?? null };
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error;
    redirect(`/login?error=trip_access&next=${encodeURIComponent(nextPath)}`);
  }
}
