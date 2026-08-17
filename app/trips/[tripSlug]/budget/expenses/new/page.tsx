import ExpenseCreatePage from "../../ExpenseCreatePage";
import { getSharedTripContext } from "../../../_shared/getSharedTripContext";

export default async function NewExpenseRoute({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const context = await getSharedTripContext(tripSlug, "/trips/" + tripSlug + "/budget/expenses/new");
  return <ExpenseCreatePage tripId={context.tripId} tripSlug={tripSlug} tripName={context.tripName} avatarUrl={context.avatarUrl} />;
}
