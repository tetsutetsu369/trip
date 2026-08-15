import BudgetPage from "@/shikoku-saburo-bbq-2026/BudgetPage";
import { getSharedTripContext } from "../_shared/getSharedTripContext";

export default async function TripBudgetPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const context = await getSharedTripContext(tripSlug, `/trips/${tripSlug}/budget`);
  return <BudgetPage tripSlug={tripSlug} tripName={context.tripName} avatarUrl={context.avatarUrl} />;
}
