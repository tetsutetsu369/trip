"use client";

import { FormEvent, useState } from "react";

type Participant = { id: string; display_name: string; profile_id: string | null; version: number };
type PendingMember = { id: string; name: string };

export default function ParticipantManager({ trip, participants, pendingMembers }: { trip: string; participants: Participant[]; pendingMembers: PendingMember[] }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Participant | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/participants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip, displayName: name }) });
    if (response.ok) window.location.reload();
    else { setMessage("仮参加者を登録できませんでした"); setBusy(false); }
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (!editing?.display_name.trim()) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/participants", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip, participantId: editing.id, displayName: editing.display_name, version: editing.version }) });
    if (response.ok) window.location.reload();
    else { setMessage(response.status === 409 ? "他の管理者が先に更新しました" : "参加者名を更新できませんでした"); setBusy(false); }
  }

  async function link(participantId: string, memberId: string) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/participants", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip, participantId, memberId }) });
    if (response.ok) window.location.reload();
    else { setMessage("紐付けできませんでした"); setBusy(false); }
  }

  async function remove(participant: Participant) {
    if (!window.confirm(`「${participant.display_name}」を完全に削除しますか？\n旅程の担当割り当ても解除されます。`)) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/participants", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip, participantId: participant.id, version: participant.version }) });
    if (response.ok) window.location.reload();
    else { setMessage(response.status === 409 ? "他の管理者が先に更新しました" : "参加者を削除できませんでした"); setBusy(false); }
  }

  return <section className="admin-card participant-manager"><h2>旅行参加者</h2><p>ログイン前でも名前だけ先に登録できます。ログイン後の参加申請者と紐付けると、すでに割り当てた旅程をそのまま引き継げます。</p><form className="participant-create-form" onSubmit={create}><input value={name} placeholder="例：山田 太郎" onChange={(event) => setName(event.target.value)} /><button disabled={busy}>仮参加者を登録</button></form><div className="participant-link-list">{participants.map((participant) => <div key={participant.id}>{editing?.id === participant.id ? <form className="participant-edit-form" onSubmit={update}><input aria-label="参加者名" value={editing.display_name} onChange={(event) => setEditing({ ...editing, display_name: event.target.value })} /><div className="participant-actions"><button type="submit" disabled={busy}>保存</button><button type="button" className="muted-action" onClick={() => setEditing(null)} disabled={busy}>キャンセル</button></div></form> : <><div className="participant-row-main"><strong>{participant.display_name}</strong><small>{participant.profile_id ? "ログイン済みと紐付け済み" : "仮登録"}</small></div><div className="participant-actions"><button type="button" className="text-button" onClick={() => setEditing(participant)} disabled={busy}>編集</button><button type="button" className="text-button danger" onClick={() => void remove(participant)} disabled={busy}>削除</button>{!participant.profile_id && (pendingMembers.length ? <select aria-label={`${participant.display_name}の紐付け`} defaultValue="" disabled={busy} onChange={(event) => event.target.value && void link(participant.id, event.target.value)}><option value="">初回ログインした人を選ぶ</option>{pendingMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select> : <span>ログイン待ち</span>)}</div></>}</div>)}</div>{!participants.length && <p className="empty-state">参加者はまだ登録されていません。</p>}{message && <p className="admin-action-error">{message}</p>}</section>;
}
