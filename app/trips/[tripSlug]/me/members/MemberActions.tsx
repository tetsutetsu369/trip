"use client";

import { useState } from "react";

type Member = { id: string; user_id: string; role: "member" | "admin"; status: "pending" | "approved" | "rejected" | "removed"; version: number };

export default function MemberActions({ member, tripSlug, currentUserId }: { member: Member; tripSlug: string; currentUserId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isSelf = member.user_id === currentUserId;

  async function update(patch: Record<string, string>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...patch, version: member.version, trip: tripSlug }) });
      if (!response.ok) throw new Error(response.status === 409 ? "他の管理者が先に更新しました" : "更新に失敗しました");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新に失敗しました");
      setBusy(false);
    }
  }

  async function removeMember() {
    if (!window.confirm(`この参加者を完全に削除しますか？\n参加者の旅程担当割り当ても解除されます。`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${member.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: member.version, trip: tripSlug }) });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        const message = body?.error === "last_admin" ? "最後の管理者は削除できません" : body?.error === "version_conflict" ? "他の管理者が先に更新しました" : "削除に失敗しました";
        throw new Error(message);
      }
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "削除に失敗しました");
      setBusy(false);
    }
  }

  return <div className="admin-member-actions">
    {member.status === "pending" && <><button disabled={busy} onClick={() => update({ status: "approved" })}>承認</button><button disabled={busy} className="muted-action" onClick={() => update({ status: "rejected" })}>却下</button></>}
    {member.status === "approved" && <button disabled={busy || isSelf} className="muted-action" onClick={() => void removeMember()}>完全削除</button>}
    {member.status === "removed" && <button disabled={busy} className="muted-action" onClick={() => void removeMember()}>残った記録を削除</button>}
    {member.status === "approved" && <button disabled={busy || isSelf} className="muted-action" onClick={() => update({ role: member.role === "admin" ? "member" : "admin" })}>{member.role === "admin" ? "参加者へ戻す" : "管理者にする"}</button>}
    {message && <small className="admin-action-error">{message}</small>}
  </div>;
}
