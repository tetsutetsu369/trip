import SharedTripPage from "../shared/SharedTripPage";
import { getSharedTripContext } from "../shared/getSharedTripContext";

export default async function NotesPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  return <SharedTripPage {...(await getSharedTripContext(tripSlug, `/trips/${tripSlug}/notes`))} focus="notes" />;
}
