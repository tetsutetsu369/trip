"use client";

import { FormEvent, useState } from "react";

type Participant = { id: string; display_name: string; profile_id: string | null };
type PendingMember = { id: string; name: string };

export default function ParticipantManager({ trip, participants, pendingMembers }: { trip: string; participants: Participant[]; pendingMembers: PendingMember[] }) {
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function create(event: FormEvent) { event.preventDefault(); if (!name.trim()) return; setBusy(true); const response = await fetch("/api/admin/participants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip, displayName: name }) }); if (response.ok) window.location.reload(); else { setMessage("仮参加者を登録できませんでした"); setBusy(false); } }
  async function link(participantId: string, memberId: string) { setBusy(true); const response = await fetch("/api/admin/participants", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip, participantId, memberId }) }); if (response.ok) window.location.reload(); else { setMessage("紐付けできませんでした"); setBusy(false); } }
  const unlinked = participants.filter((participant) => !participant.profile_id);
  return <section className="admin-card participant-manager"><h2>旅行参加者</h2><p>ログイン前でも名前だけ先に登録できます。ログイン後の参加申請者と紐付けると、すでに割り当てた旅程をそのまま引き継げます。</p><form onSubmit={create}><input value={name} placeholder="例：山田 太郎" onChange={(event) => setName(event.target.value)} /><button disabled={busy}>仮参加者を登録</button></form>{unlinked.length > 0 && <div className="participant-link-list">{unlinked.map((participant) => <div key={participant.id}><strong>{participant.display_name}</strong>{pendingMembers.length ? <select defaultValue="" disabled={busy} onChange={(event) => event.target.value && link(participant.id, event.target.value)}><option value="">初回ログインした人を選ぶ</option>{pendingMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select> : <span>ログイン待ち</span>}</div>)}</div>}{message && <p className="admin-action-error">{message}</p>}</section>;
}
