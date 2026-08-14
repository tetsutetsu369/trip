"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Person = { id: string; display_name: string; avatar_color: string | null };
type Itinerary = { id: string; event_date: string | null; event_time: string | null; title: string; place: string; notes: string; sort_order: number; version: number };
type Packing = { id: string; name: string; memo: string; is_ready: boolean; version: number };
type Note = { id: string; title: string; body: string; version: number };
type Assignment = { itinerary_item_id: string; participant_id: string };
type Draft = { event_date: string; event_time: string; title: string; place: string; notes: string; assigneeIds: string[] };

const blank = (date: string): Draft => ({ event_date: date, event_time: "", title: "", place: "", notes: "", assigneeIds: [] });

export default function SharedTripPage({ tripId, tripSlug, tripDates, participants }: { tripId: string; tripSlug: string; tripDates: { start: string; end: string }; participants: Person[] }) {
  const supabase = createBrowserSupabaseClient();
  const dates = [tripDates.start, tripDates.end];
  const people = useMemo(() => new Map(participants.map((person) => [person.id, person])), [participants]);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [packing, setPacking] = useState<Packing[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blank(tripDates.start));
  const [packingDraft, setPackingDraft] = useState<any>({ name: "", memo: "" });
  const [noteDraft, setNoteDraft] = useState<any>({ title: "", body: "" });
  const [editItinerary, setEditItinerary] = useState<(Draft & { id: string; version: number }) | null>(null);
  const [editPacking, setEditPacking] = useState<Packing | null>(null);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("保存済みデータを読み込み中…");

  const load = async () => {
    if (!supabase) return;
    const [i, p, n] = await Promise.all([
      supabase.from("itinerary_items").select("id,event_date,event_time,title,place,notes,sort_order,version").eq("trip_id", tripId),
      supabase.from("packing_items").select("id,name,memo,is_ready,version").eq("trip_id", tripId).order("created_at"),
      supabase.from("shared_notes").select("id,title,body,version").eq("trip_id", tripId).order("updated_at", { ascending: false }),
    ]);
    if (i.error || p.error || n.error) { setStatus("保存済みデータを読み込めませんでした"); return; }
    const items = [...(i.data ?? [])].sort((a, b) => `${a.event_date ?? "9999"}${a.event_time ?? "99"}`.localeCompare(`${b.event_date ?? "9999"}${b.event_time ?? "99"}`) || a.sort_order - b.sort_order);
    const a = items.length ? await supabase.from("itinerary_assignees").select("itinerary_item_id,participant_id").in("itinerary_item_id", items.map((item) => item.id)) : { data: [], error: null };
    if (a.error) { setStatus("担当者データを読み込めませんでした"); return; }
    setItinerary(items); setPacking(p.data ?? []); setNotes(n.data ?? []); setAssignments(a.data ?? []); setStatus("保存済みデータを表示中");
  };
  useEffect(() => { void load(); }, [tripId]);

  const selected = (id: string) => assignments.filter((a) => a.itinerary_item_id === id).map((a) => a.participant_id);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  const persistAssignments = async (itemId: string, ids: string[]) => {
    if (!supabase) return false;
    if ((await supabase.from("itinerary_assignees").delete().eq("itinerary_item_id", itemId)).error) return false;
    return !ids.length || !(await supabase.from("itinerary_assignees").insert(ids.map((participant_id) => ({ itinerary_item_id: itemId, participant_id })))).error;
  };
  const saveNewItinerary = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !draft.title.trim()) return; setSaving(true);
    const sort_order = Math.max(-1, ...itinerary.map((item) => item.sort_order)) + 1;
    const { data, error } = await supabase.from("itinerary_items").insert({ trip_id: tripId, event_date: draft.event_date, event_time: draft.event_time || null, title: draft.title.trim(), place: draft.place.trim(), notes: draft.notes.trim(), sort_order }).select("id").single<{ id: string }>();
    if (error || !data || !(await persistAssignments(data.id, draft.assigneeIds))) setStatus("旅程を保存できませんでした"); else { setDraft(blank(draft.event_date)); await load(); }
    setSaving(false);
  };
  const saveItineraryEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !editItinerary?.title.trim()) return; setSaving(true);
    const { error } = await supabase.from("itinerary_items").update({ event_date: editItinerary.event_date, event_time: editItinerary.event_time || null, title: editItinerary.title.trim(), place: editItinerary.place.trim(), notes: editItinerary.notes.trim() }).eq("id", editItinerary.id).eq("version", editItinerary.version);
    if (error || !(await persistAssignments(editItinerary.id, editItinerary.assigneeIds))) setStatus("旅程を更新できませんでした。ほかの人の変更も確認してください"); else { setEditItinerary(null); await load(); }
    setSaving(false);
  };
  const savePacking = async (event: FormEvent, editing = false) => {
    event.preventDefault(); if (!supabase) return; const value = editing ? editPacking : packingDraft; if (!value?.name.trim()) return; setSaving(true);
    const result = editing ? await supabase.from("packing_items").update({ name: value.name.trim(), memo: value.memo.trim(), is_ready: "is_ready" in value ? value.is_ready : false }).eq("id", value.id).eq("version", value.version) : await supabase.from("packing_items").insert({ trip_id: tripId, name: value.name.trim(), memo: value.memo.trim() });
    setSaving(false); if (result.error) setStatus("持ち物を保存できませんでした"); else { setEditPacking(null); setPackingDraft({ name: "", memo: "" }); await load(); }
  };
  const saveNote = async (event: FormEvent, editing = false) => {
    event.preventDefault(); if (!supabase) return; const value = editing ? editNote : noteDraft; if (!value?.title.trim()) return; setSaving(true);
    const result = editing ? await supabase.from("shared_notes").update({ title: value.title.trim(), body: value.body.trim() }).eq("id", value.id).eq("version", value.version) : await supabase.from("shared_notes").insert({ trip_id: tripId, title: value.title.trim(), body: value.body.trim() });
    setSaving(false); if (result.error) setStatus("メモを保存できませんでした"); else { setEditNote(null); setNoteDraft({ title: "", body: "" }); await load(); }
  };
  const itineraryFields = (value: Draft, setValue: (value: Draft) => void) => <><div className="itinerary-time-fields"><label>日付<select value={value.event_date} onChange={(e) => setValue({ ...value, event_date: e.target.value })}>{dates.map((date) => <option key={date}>{date.replaceAll("-", "/")}</option>)}</select></label><label>時刻（5分刻み）<input type="time" step="300" value={value.event_time} onChange={(e) => setValue({ ...value, event_time: e.target.value })} /></label></div><label>予定名<input required value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} /></label><label>場所<input value={value.place} onChange={(e) => setValue({ ...value, place: e.target.value })} /></label><fieldset><legend>この予定に該当する人</legend><div className="participant-options">{participants.map((person) => <label key={person.id}><input type="checkbox" checked={value.assigneeIds.includes(person.id)} onChange={() => setValue({ ...value, assigneeIds: toggle(value.assigneeIds, person.id) })} />{person.display_name}</label>)}</div></fieldset><label>メモ<textarea value={value.notes} onChange={(e) => setValue({ ...value, notes: e.target.value })} /></label></>;
  return <main className="shared-shell"><Link className="shared-back" href={`/trips/${tripSlug}`}>← ポータルへ戻る</Link><p className="shared-kicker">SHARED TRIP DATA</p><h1>旅程・持ち物・共有メモ</h1><p className="shared-status" role="status">{status}</p>
    <section id="itinerary" className="shared-panel"><div className="shared-heading"><div><p>ITINERARY</p><h2>保存済みの旅程</h2></div><span className="saved-badge">DB保存済み</span></div><div className="timeline">{itinerary.map((item) => <article className="timeline-item" key={item.id}><div className="timeline-time"><strong>{item.event_time?.slice(0, 5) || "未定"}</strong><span>{item.event_date?.replaceAll("-", "/")}</span></div><div className="timeline-dot"/><div className="timeline-card">{editItinerary?.id === item.id ? <form className="draft-form" onSubmit={saveItineraryEdit}>{itineraryFields(editItinerary, (value) => setEditItinerary({ ...editItinerary, ...value }))}<div className="inline-actions"><button className="save-button" disabled={saving}>変更をDBへ保存</button><button type="button" onClick={() => setEditItinerary(null)}>キャンセル</button></div></form> : <><button className="edit-button" onClick={() => setEditItinerary({ id: item.id, version: item.version, event_date: item.event_date || tripDates.start, event_time: item.event_time?.slice(0, 5) || "", title: item.title, place: item.place, notes: item.notes, assigneeIds: selected(item.id) })}>編集</button><h3>{item.title}</h3>{item.place && <p className="timeline-place">{item.place}</p>}{item.notes && <p>{item.notes}</p>}<div className="assignee-chips">{selected(item.id).map((id) => <span key={id} style={{ background: people.get(id)?.avatar_color ?? "#e5efe7" }}>{people.get(id)?.display_name}</span>) || <span className="unassigned">担当者未設定</span>}</div></>}</div></article>)}</div></section>
    <section className="shared-panel draft-panel"><div className="shared-heading"><div><p>ADD ITINERARY</p><h2>旅程を追加</h2></div><span className="draft-badge">下書き・未保存</span></div><form className="draft-form" onSubmit={saveNewItinerary}>{itineraryFields(draft, setDraft)}<button className="save-button" disabled={saving}>この旅程をDBへ保存</button></form></section>
    <section id="packing" className="shared-panel"><div className="shared-heading"><div><p>PACKING</p><h2>保存済みの持ち物</h2></div><span className="saved-badge">DB保存済み</span></div>{packing.map((item) => editPacking?.id === item.id ? <form className="draft-form compact-form" key={item.id} onSubmit={(e) => savePacking(e, true)}><input value={editPacking.name} onChange={(e) => setEditPacking({ ...editPacking, name: e.target.value })}/><input value={editPacking.memo} onChange={(e) => setEditPacking({ ...editPacking, memo: e.target.value })}/><button className="save-button">変更を保存</button></form> : <div className="saved-row" key={item.id}><button className="edit-button" onClick={() => setEditPacking(item)}>編集</button><strong>{item.name}</strong><span>{item.memo}</span></div>)}</section>
    <section className="shared-panel draft-panel"><div className="shared-heading"><div><p>ADD PACKING</p><h2>持ち物を追加</h2></div><span className="draft-badge">下書き・未保存</span></div><form className="draft-form compact-form" onSubmit={(e) => savePacking(e)}><input required value={packingDraft.name} placeholder="持ち物名" onChange={(e) => setPackingDraft({ ...packingDraft, name: e.target.value })}/><input value={packingDraft.memo} placeholder="誰が持つ・数量など" onChange={(e) => setPackingDraft({ ...packingDraft, memo: e.target.value })}/><button className="save-button">DBへ保存</button></form></section>
    <section id="notes" className="shared-panel"><div className="shared-heading"><div><p>SHARED NOTES</p><h2>保存済みの共有メモ</h2></div><span className="saved-badge">DB保存済み</span></div>{notes.map((item) => editNote?.id === item.id ? <form className="draft-form" key={item.id} onSubmit={(e) => saveNote(e, true)}><input value={editNote.title} onChange={(e) => setEditNote({ ...editNote, title: e.target.value })}/><textarea value={editNote.body} onChange={(e) => setEditNote({ ...editNote, body: e.target.value })}/><button className="save-button">変更を保存</button></form> : <div className="saved-row" key={item.id}><button className="edit-button" onClick={() => setEditNote(item)}>編集</button><strong>{item.title}</strong><span>{item.body}</span></div>)}</section>
    <section className="shared-panel draft-panel"><div className="shared-heading"><div><p>ADD NOTE</p><h2>共有メモを追加</h2></div><span className="draft-badge">下書き・未保存</span></div><form className="draft-form" onSubmit={(e) => saveNote(e)}><input required value={noteDraft.title} placeholder="メモの題名" onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })}/><textarea value={noteDraft.body} placeholder="内容" onChange={(e) => setNoteDraft({ ...noteDraft, body: e.target.value })}/><button className="save-button">このメモをDBへ保存</button></form></section>
  </main>;
}
