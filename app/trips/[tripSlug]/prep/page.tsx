import SharedTripPage from "../_shared/SharedTripPage";
import { getSharedTripContext } from "../_shared/getSharedTripContext";

// 持ち物と共有メモを1画面にまとめた「準備」タブ。
export default async function PrepPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  return <SharedTripPage {...(await getSharedTripContext(tripSlug, `/trips/${tripSlug}/prep`))} focus="prep" />;
}
