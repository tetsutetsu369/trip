"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Person = { id: string; nickname: string; line_display_name: string; avatar_color: string | null };
type ItineraryItem = { id: string; event_date: string | null; event_time: string | null; place: string; title: string; notes: string; is_completed: boolean; sort_order: number };
type Assignment = { itinerary_item_id: string; user_id: string };
type PackingItem = { id: string; name: string; memo: string; is_ready: boolean };
type SharedNote = { id: string; title: string; body: string };
type DraftItinerary = { event_date: string; event_time: string; title: string; place: string; notes: string; assigneeIds: string[] };

const blankItinerary = (date: string): DraftItinerary => ({ event_date: date, event_time: "", title: "", place: "", notes: "", assigneeIds: [] });

function compareItinerary(left: ItineraryItem, right: ItineraryItem) {
  const leftKey = `${left.event_date ?? "9999-12-31"}T${left.event_time ?? "23:59:59"}`;
  const rightKey = `${right.event_date ?? "9999-12-31"}T${right.event_time ?? "23:59:59"}`;
  return leftKey.localeCompare(rightKey) || left.sort_order - right.sort_order;
}

export default function SharedTripPage({ tripId, tripSlug, tripDates, participants }: { tripId: string; tripSlug: string; tripDates: { start: string; end: string }; participants: Person[] }) {
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [packing, setPacking] = useState<PackingItem[]>([]);
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [draft, setDraft] = useState<DraftItinerary>(() => blankItinerary(tripDates.start));
  const [packingDraft, setPackingDraft] = useState({ name: "", memo: "" });
  const [noteDraft, setNoteDraft] = useState({ title: "", body: "" });
  const [status, setStatus] = useState("保存済みデータを読み込み中…");
  const [saving, setSaving] = useState(false);
  const supabase = createBrowserSupabaseClient();
  const dates = useMemo(() => [tripDates.start, tripDates.end], [tripDates]);
  const participantById = useMemo(() => new Map(participants.map((person) => [person.id, person])), [participants]);

  const load = async () => {
    if (!supabase) return;
    const [itineraryResult, packingResult, notesResult] = await Promise.all([
      supabase.from("itinerary_items").select("id,event_date,event_time,place,title,notes,is_completed,sort_order").eq("trip_id", tripId),
      supabase.from("packing_items").select("id,name,memo,is_ready").eq("trip_id", tripId).order("created_at"),
      supabase.from("shared_notes").select("id,title,body").eq("trip_id", tripId).order("updated_at", { ascending: false }),
    ]);
    if (itineraryResult.error || packingResult.error || notesResult.error) { setStatus("保存済みデータを読み込めませんでした"); return; }
    const savedItinerary = [...(itineraryResult.data ?? [])].sort(compareItinerary);
    setItinerary(savedItinerary); setPacking(packingResult.data ?? []); setNotes(notesResult.data ?? []);
    if (savedItinerary.length) {
      const { data, error } = await supabase.from("itinerary_assignees").select("itinerary_item_id,user_id").in("itinerary_item_id", savedItinerary.map((item) => item.id));
      if (!error) setAssignments(data ?? []);
    }
    setStatus("保存済みデータを表示中");
  };

  useEffect(() => { void load(); }, [tripId]);

  const saveItinerary = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !draft.title.trim()) return;
    setSaving(true); setStatus("旅程をDBへ保存中…");
    const nextOrder = Math.max(-1, ...itinerary.map((item) => item.sort_order)) + 1;
    const { data: item, error } = await supabase.from("itinerary_items").insert({ trip_id: tripId, event_date: draft.event_date, event_time: draft.event_time || null, title: draft.title.trim(), place: draft.place.trim(), notes: draft.notes.trim(), sort_order: nextOrder }).select("id,event_date,event_time,place,title,notes,is_completed,sort_order").single<ItineraryItem>();
    if (error || !item) { setStatus("旅程を保存できませんでした"); setSaving(false); return; }
    if (draft.assigneeIds.length) {
      const { error: assigneeError } = await supabase.from("itinerary_assignees").insert(draft.assigneeIds.map((user_id) => ({ itinerary_item_id: item.id, user_id })));
      if (assigneeError) { setStatus("予定は保存されましたが、担当者を保存できませんでした"); setSaving(false); await load(); return; }
    }
    setDraft(blankItinerary(draft.event_date)); setSaving(false); await load();
  };

  const savePacking = async (event: FormEvent) => { event.preventDefault(); if (!supabase || !packingDraft.name.trim()) return; setSaving(true); const { error } = await supabase.from("packing_items").insert({ trip_id: tripId, name: packingDraft.name.trim(), memo: packingDraft.memo.trim() }); setSaving(false); if (error) { setStatus("持ち物を保存できませんでした"); return; } setPackingDraft({ name: "", memo: "" }); await load(); };
  const saveNote = async (event: FormEvent) => { event.preventDefault(); if (!supabase || !noteDraft.title.trim()) return; setSaving(true); const { error } = await supabase.from("shared_notes").insert({ trip_id: tripId, title: noteDraft.title.trim(), body: noteDraft.body.trim() }); setSaving(false); if (error) { setStatus("メモを保存できませんでした"); return; } setNoteDraft({ title: "", body: "" }); await load(); };
  const assigneesFor = (itemId: string) => assignments.filter((assignment) => assignment.itinerary_item_id === itemId).map((assignment) => participantById.get(assignment.user_id)).filter((person): person is Person => Boolean(person));

  return <main className="shared-shell">
    <Link className="shared-back" href={`/trips/${tripSlug}`}>← ポータルへ戻る</Link>
    <section className="shared-hero"><p>SHARED TRIP DATA</p><h1>旅程・持ち物・共有メモ</h1><span>{status}</span></section>

    <section id="itinerary" className="shared-panel"><div className="shared-heading"><div><p>ITINERARY</p><h2>保存済みの旅程</h2></div><span className="saved-badge">DB保存済み</span></div><div className="timeline">{itinerary.length === 0 ? <p className="shared-empty">まだ保存済みの予定はありません。</p> : itinerary.map((item) => <article className="timeline-item" key={item.id}><div className="timeline-time"><strong>{item.event_time?.slice(0, 5) || "未定"}</strong><span>{item.event_date?.replaceAll("-", "/") || "日付未定"}</span></div><div className="timeline-dot"/><div className="timeline-card"><h3>{item.title}</h3>{item.place && <p className="timeline-place">{item.place}</p>}{item.notes && <p>{item.notes}</p>}<div className="assignee-chips">{assigneesFor(item.id).length ? assigneesFor(item.id).map((person) => <span key={person.id} style={{ background: person.avatar_color ?? "#e5efe7" }}>{person.nickname || person.line_display_name}</span>) : <span className="unassigned">担当者未設定</span>}</div></div></article>)}</div></section>

    <section className="shared-panel draft-panel"><div className="shared-heading"><div><p>ADD ITINERARY</p><h2>旅程を追加</h2></div><span className="draft-badge">下書き・未保存</span></div><form className="draft-form" onSubmit={saveItinerary}><div className="itinerary-time-fields"><label>日付<select value={draft.event_date} onChange={(event) => setDraft({ ...draft, event_date: event.target.value })}>{dates.map((date) => <option key={date} value={date}>{date.replaceAll("-", "/")}</option>)}</select></label><label>時刻（5分刻み）<input type="time" step="300" value={draft.event_time} onChange={(event) => setDraft({ ...draft, event_time: event.target.value })} /></label></div><label>予定名<input required value={draft.title} placeholder="例：キャンプ場に集合" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>場所<input value={draft.place} placeholder="例：四国三郎の郷" onChange={(event) => setDraft({ ...draft, place: event.target.value })} /></label><fieldset><legend>この予定に該当する人</legend><div className="participant-options">{participants.map((person) => <label key={person.id}><input type="checkbox" checked={draft.assigneeIds.includes(person.id)} onChange={() => setDraft((current) => ({ ...current, assigneeIds: current.assigneeIds.includes(person.id) ? current.assigneeIds.filter((id) => id !== person.id) : [...current.assigneeIds, person.id] }))} />{person.nickname || person.line_display_name}</label>)}</div></fieldset><label>メモ<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label><button className="save-button" disabled={saving}>{saving ? "保存中…" : "この旅程をDBへ保存"}</button></form></section>

    <SavedList title="保存済みの持ち物" label="PACKING" empty="まだ保存済みの持ち物はありません。">{packing.map((item) => <div className="saved-row" key={item.id}><strong>{item.name}</strong><span>{item.memo}</span></div>)}</SavedList>
    <section className="shared-panel draft-panel"><div className="shared-heading"><div><p>ADD PACKING</p><h2>持ち物を追加</h2></div><span className="draft-badge">下書き・未保存</span></div><form className="draft-form compact-form" onSubmit={savePacking}><input required value={packingDraft.name} placeholder="持ち物名" onChange={(event) => setPackingDraft({ ...packingDraft, name: event.target.value })} /><input value={packingDraft.memo} placeholder="誰が持つ・数量など" onChange={(event) => setPackingDraft({ ...packingDraft, memo: event.target.value })} /><button className="save-button" disabled={saving}>DBへ保存</button></form></section>
    <SavedList title="保存済みの共有メモ" label="SHARED NOTES" empty="まだ保存済みのメモはありません。">{notes.map((note) => <div className="saved-row note-row" key={note.id}><strong>{note.title}</strong><span>{note.body}</span></div>)}</SavedList>
    <section className="shared-panel draft-panel"><div className="shared-heading"><div><p>ADD NOTE</p><h2>共有メモを追加</h2></div><span className="draft-badge">下書き・未保存</span></div><form className="draft-form" onSubmit={saveNote}><input required value={noteDraft.title} placeholder="メモの題名" onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })} /><textarea value={noteDraft.body} placeholder="内容" onChange={(event) => setNoteDraft({ ...noteDraft, body: event.target.value })} /><button className="save-button" disabled={saving}>このメモをDBへ保存</button></form></section>
  </main>;
}

function SavedList({ title, label, empty, children }: { title: string; label: string; empty: string; children: React.ReactNode }) { return <section className="shared-panel"><div className="shared-heading"><div><p>{label}</p><h2>{title}</h2></div><span className="saved-badge">DB保存済み</span></div><div className="saved-list">{children || <p className="shared-empty">{empty}</p>}</div></section>; }
