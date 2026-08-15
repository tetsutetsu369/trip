import { redirect } from "next/navigation";
import TripHeader from "@/app/components/TripHeader";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSharedTripContext } from "../shared/getSharedTripContext";
import ProfileEditor from "./ProfileEditor";

export default async function ProfilePage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const context = await getSharedTripContext(tripSlug, `/trips/${tripSlug}/profile`);
  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(`/login?next=/trips/${tripSlug}/profile`);
  const { data: profile } = await supabase.from("profiles").select("nickname,line_display_name,avatar_url,avatar_color,bio").eq("id", context.userId).maybeSingle<ProfileData>();
  return <main className="profile-shell"><TripHeader tripSlug={tripSlug} active="profile" showAdmin={context.isAdmin} avatarUrl={context.avatarUrl} /><section className="profile-card"><p className="auth-eyebrow">YOUR PROFILE</p><h1>プロフィールを編集</h1><p className="profile-intro">旅の仲間に表示される名前と自己紹介を設定できます。</p><ProfileEditor userId={context.userId} profile={profile ?? { nickname: "", line_display_name: "", avatar_url: null, avatar_color: "#e2793f", bio: "" }} /></section></main>;
}

type ProfileData = { nickname: string; line_display_name: string; avatar_url: string | null; avatar_color: string | null; bio: string };
