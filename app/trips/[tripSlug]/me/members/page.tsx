import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/trips/admin";
import { getTripSiteConfig } from "@/lib/trips/site-config";
import MemberActions from "./MemberActions";
import ParticipantManager from "./ParticipantManager";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";

type Member = {
  id: string;
  user_id: string;
  role: "member" | "admin";
  status: "pending" | "approved" | "rejected" | "removed";
  version: number;
};

type Profile = {
  id: string;
  line_display_name: string;
  nickname: string;
  avatar_url: string | null;
  avatar_color: string | null;
};

export default async function MembersPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return <AdminUnavailable />;

  const context = await getAdminContext(supabase, tripSlug);
  if (!context) redirect(`/pending?trip=${tripSlug}`);

  const { data: members, error } = await supabase
    .from("trip_members")
    .select("id, user_id, role, status, version")
    .eq("trip_id", context.trip.id)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: true })
    .returns<Member[]>();

  if (error) throw error;

  const userIds = (members ?? []).map((member) => member.user_id);
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, line_display_name, nickname, avatar_url, avatar_color")
        .in("id", userIds)
        .returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const { data: participants } = await supabase.from("trip_participants").select("id,display_name,profile_id,version").eq("trip_id", context.trip.id).order("created_at");
  const pendingMembers = (members ?? []).filter((member) => member.status === "pending").map((member) => ({ id: member.id, name: profileById.get(member.user_id)?.nickname || profileById.get(member.user_id)?.line_display_name || "参加申請者" }));
  const { data: profile } = await supabase.from("profiles").select("avatar_url").eq("id", context.user.id).maybeSingle<{ avatar_url: string | null }>();

  return (
    <main className="admin-shell">
      <TripHeader tripSlug={tripSlug} tripName={getTripSiteConfig(tripSlug)?.title ?? context.trip.name} avatarUrl={profile?.avatar_url ?? null} />
      <div className="admin-heading">
        <div>
          <p className="auth-eyebrow">ADMINISTRATION</p>
          <h1>参加者を管理</h1>
          <p>{context.trip.name}</p>
        </div>
      </div>

      <section className="admin-card">
        <div className="admin-table-heading"><span>参加者</span><span>状態・権限</span><span>操作</span></div>
        {(members ?? []).map((member) => {
          const memberProfile = profileById.get(member.user_id);
          const memberName = member.status === "pending"
            ? memberProfile?.line_display_name || memberProfile?.nickname || "参加申請者"
            : memberProfile?.nickname || memberProfile?.line_display_name || "参加者";
          return (
            <div className="admin-member-row" key={member.id}>
              <div className={`admin-member-profile ${member.status === "pending" ? "is-pending" : ""}`}>
                {memberProfile?.avatar_url ? <img className="profile-avatar" src={memberProfile.avatar_url} alt="" /> : <span className="profile-dot" style={{ background: memberProfile?.avatar_color ?? "#b65f32" }} aria-hidden>{memberName.slice(0, 1)}</span>}
                <div><strong>{memberName}</strong><small>{member.status === "pending" ? `LINE名: ${memberProfile?.line_display_name || "取得できません"}` : memberProfile?.line_display_name ? `LINE名: ${memberProfile.line_display_name}` : "LINE情報なし"}</small></div>
              </div>
              <div><span className={`member-status ${member.status}`}>{statusLabel(member.status)}</span><span className="member-role">{member.role === "admin" ? "管理者" : "参加者"}</span></div>
              <MemberActions member={member} tripSlug={tripSlug} currentUserId={context.user.id} />
            </div>
          );
        })}
      </section>
      <ParticipantManager trip={tripSlug} participants={participants ?? []} pendingMembers={pendingMembers} />
      <TripTabs tripSlug={tripSlug} active="me" />
    </main>
  );
}

function statusLabel(status: Member["status"]) {
  return { pending: "申請中", approved: "承認済み", rejected: "却下", removed: "削除済み" }[status];
}

function AdminUnavailable() {
  return <main className="auth-shell"><section className="auth-card"><h1>管理画面を準備中です</h1><p>Supabaseの接続設定が完了すると利用できます。</p></section></main>;
}
