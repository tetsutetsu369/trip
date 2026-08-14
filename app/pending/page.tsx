import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTripIdBySlug } from "@/lib/trips/membership";

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const { trip = "shikoku-saburo-bbq-2026" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return <PendingMessage />;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect(`/login?next=/trips/${trip}`);

  const tripId = await getTripIdBySlug(supabase, trip);
  const { data: membership } = await supabase
    .from("trip_members")
    .select("status")
    .eq("trip_id", tripId)
    .eq("user_id", userData.user.id)
    .maybeSingle<{ status: string }>();

  if (membership?.status === "approved") redirect(`/trips/${trip}`);
  return <PendingMessage status={membership?.status} />;
}

function PendingMessage({ status }: { status?: string }) {
  const title = status === "rejected" ? "参加申請が却下されています" : status === "removed" ? "参加権限がありません" : "参加申請を受け付けました";
  const description = status === "rejected" || status === "removed" ? "管理者に確認してください。" : "管理者の承認後、この旅行のポータルを利用できます。";

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-eyebrow">TRIP PORTAL</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <Link className="auth-back-link" href="/auth/logout">ログアウト</Link>
      </section>
    </main>
  );
}

