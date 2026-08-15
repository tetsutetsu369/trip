import Link from "next/link";
import { redirect } from "next/navigation";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSharedTripContext } from "../_shared/getSharedTripContext";
import ProfileEditor from "./ProfileEditor";
import BudgetBackup from "./BudgetBackup";

type ProfileData = { nickname: string; line_display_name: string; avatar_url: string | null; avatar_color: string | null; bio: string };

export default async function MePage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const context = await getSharedTripContext(tripSlug, `/trips/${tripSlug}/me`);
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(`/login?next=/trips/${tripSlug}/me`);
  const { data: profile } = await supabase.from("profiles").select("nickname,line_display_name,avatar_url,avatar_color,bio").eq("id", context.userId).maybeSingle<ProfileData>();

  return <main className="profile-shell">
    <TripHeader tripSlug={tripSlug} tripName={context.tripName} avatarUrl={context.avatarUrl} />
    <section className="profile-card">
      <p className="auth-eyebrow">YOUR PROFILE</p>
      <h1>自分の設定</h1>
      <p className="profile-intro">旅の仲間に表示される名前と自己紹介を設定できます。</p>
      <ProfileEditor userId={context.userId} profile={profile ?? { nickname: "", line_display_name: "", avatar_url: null, avatar_color: "#e2793f", bio: "" }} />
    </section>
    {/* 年に数回の管理操作は、常設リンクではなくここに置く。 */}
    {context.isAdmin && <section className="profile-card admin-area">
      <p className="auth-eyebrow">ADMINISTRATION</p>
      <h2>管理者向け</h2>
      <Link className="admin-entry" href={`/trips/${tripSlug}/me/members`}>参加者を管理する</Link>
      <BudgetBackup tripSlug={tripSlug} />
    </section>}
    <TripTabs tripSlug={tripSlug} active="me" />
  </main>;
}
