import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTripIdBySlug } from "@/lib/trips/membership";
import { getTripSiteConfig } from "@/lib/trips/site-config";
import SharedTripPage from "./SharedTripPage";

export default async function SharedPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(`/login?next=/trips/${tripSlug}/shared`);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect(`/login?next=/trips/${tripSlug}/shared`);
  try {
    const tripId = await getTripIdBySlug(supabase, tripSlug);
    const { data: membership, error } = await supabase.from("trip_members").select("status").eq("trip_id", tripId).eq("user_id", userData.user.id).maybeSingle<{ status: string }>();
    if (error) throw error;
    if (membership?.status !== "approved") redirect(`/pending?trip=${tripSlug}`);
    const { data: participants, error: participantsError } = await supabase
      .from("trip_participants")
      .select("id,display_name,avatar_color")
      .eq("trip_id", tripId)
      .order("created_at");
    if (participantsError) throw participantsError;
    const site = getTripSiteConfig(tripSlug);
    if (!site) throw new Error("Trip site configuration not found");
    return <SharedTripPage tripId={tripId} tripSlug={tripSlug} tripDates={{ start: site.startDate, end: site.endDate }} participants={participants ?? []} />;
  } catch {
    redirect(`/login?error=trip_access&next=/trips/${tripSlug}/shared`);
  }
}
