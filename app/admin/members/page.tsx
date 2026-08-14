import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/trips/admin";
import MemberActions from "./MemberActions";

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

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const { trip = "shikoku-saburo-bbq-2026" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return <AdminUnavailable />;

  const context = await getAdminContext(supabase, trip);
  if (!context) redirect(`/pending?trip=${trip}`);

  const { data: members, error } = await supabase
    .from("trip_members")
    .select("id, user_id, role, status, version")
    .eq("trip_id", context.trip.id)
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

  return (
    <main className="admin-shell">
      <div className="admin-heading">
        <div>
          <p className="auth-eyebrow">ADMINISTRATION</p>
          <h1>参加者を管理</h1>
          <p>{context.trip.name}</p>
        </div>
        <Link className="admin-back-link" href={`/trips/${trip}`}>旅行ポータルへ戻る</Link>
      </div>

      <section className="admin-card">
        <div className="admin-table-heading"><span>参加者</span><span>状態・権限</span><span>操作</span></div>
        {(members ?? []).map((member) => {
          const profile = profileById.get(member.user_id);
          return (
            <div className="admin-member-row" key={member.id}>
              <div className="admin-member-profile">
                <span className="profile-dot" style={{ background: profile?.avatar_color ?? "#b65f32" }} />
                <div><strong>{profile?.nickname || profile?.line_display_name || "参加者"}</strong><small>{profile?.line_display_name}</small></div>
              </div>
              <div><span className={`member-status ${member.status}`}>{statusLabel(member.status)}</span><span className="member-role">{member.role === "admin" ? "管理者" : "参加者"}</span></div>
              <MemberActions member={member} tripSlug={trip} currentUserId={context.user.id} />
            </div>
          );
        })}
      </section>
    </main>
  );
}

function statusLabel(status: Member["status"]) {
  return { pending: "申請中", approved: "承認済み", rejected: "却下", removed: "削除済み" }[status];
}

function AdminUnavailable() {
  return <main className="auth-shell"><section className="auth-card"><h1>管理画面を準備中です</h1><p>Supabaseの接続設定が完了すると利用できます。</p></section></main>;
}

