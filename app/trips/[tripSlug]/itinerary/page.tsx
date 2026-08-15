import SharedTripPage from "../_shared/SharedTripPage";
import { getSharedTripContext } from "../_shared/getSharedTripContext";

export default async function ItineraryPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  return <SharedTripPage {...(await getSharedTripContext(tripSlug, `/trips/${tripSlug}/itinerary`))} focus="itinerary" />;
}
