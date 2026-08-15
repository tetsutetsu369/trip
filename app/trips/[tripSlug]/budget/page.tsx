import FinancePage from "./FinancePage";
import { getSharedTripContext } from "../_shared/getSharedTripContext";

export default async function TripBudgetPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const context = await getSharedTripContext(tripSlug, `/trips/${tripSlug}/budget`);
  return <FinancePage tripId={context.tripId} tripSlug={tripSlug} tripName={context.tripName} avatarUrl={context.avatarUrl} userId={context.userId} />;
}
