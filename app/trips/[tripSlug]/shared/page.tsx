import SharedTripPage from "./SharedTripPage";
import { getSharedTripContext } from "./getSharedTripContext";

export default async function SharedPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const context = await getSharedTripContext(tripSlug, `/trips/${tripSlug}/shared`);
  return <SharedTripPage {...context} focus="all" />;
}
