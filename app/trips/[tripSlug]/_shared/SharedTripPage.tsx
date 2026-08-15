"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

// 「準備」は持ち物とメモを1画面に統合したタブ。
type Focus = "itinerary" | "prep";
type Person = { id: string; display_name: string; avatar_color: string | null };
type Itinerary = { id: string; event_date: string | null; event_time: string | null; title: string; place: string; notes: string; sort_order: number; version: number };
type Packing = { id: string; name: string; memo: string; is_ready: boolean; version: number };
type Note = { id: string; title: string; body: string; version: number };
type Assignment = { itinerary_item_id: string; participant_id: string };
type Draft = { event_date: string; event_time: string; title: string; place: string; notes: string; assigneeIds: string[] };

type SaveResult = { status: "ok" | "conflict" | "forbidden" | "invalid"; id?: string; version?: number };

const blank = (date: string): Draft => ({ event_date: date, event_time: "", title: "", place: "", notes: "", assigneeIds: [] });
const CONFLICT_MESSAGE = "他の人が先に保存しました。最新を読み込みます";

export default function SharedTripPage({
  tripId, tripSlug, tripName, tripDates, participants, avatarUrl = null, focus,
}: { tripId: string; tripSlug: string; tripName: string; tripDates: { start: string; end: string }; participants: Person[]; avatarUrl?: string | null; focus: Focus }) {
  const supabase = createBrowserSupabaseClient();
  const dates = [tripDates.start, tripDates.end];
  const people = useMemo(() => new Map(participants.map((person) => [person.id, person])), [participants]);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [packing, setPacking] = useState<Packing[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blank(tripDates.start));
  const [packingDraft, setPackingDraft] = useState({ name: "", memo: "" });
  const [noteDraft, setNoteDraft] = useState({ title: "", body: "" });
  const [editItinerary, setEditItinerary] = useState<(Draft & { id: string; version: number }) | null>(null);
  const [editPacking, setEditPacking] = useState<Packing | null>(null);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("保存済みデータを読み込み中…");
  const [now, setNow] = useState(() => new Date());

  const load = async (message = "最新の保存内容を表示中") => {
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
    setItinerary(items); setPacking(p.data ?? []); setNotes(n.data ?? []); setAssignments(a.data ?? []); setStatus(message);
  };
  useEffect(() => { void load(); }, [tripId]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);

  const selected = (id: string) => assignments.filter((a) => a.itinerary_item_id === id).map((a) => a.participant_id);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  const eventAt = (item: Itinerary) => new Date(`${item.event_date ?? tripDates.start}T${item.event_time?.slice(0, 5) || "00:00"}:00`).getTime();
  const timelineState = useMemo(() => {
    const currentTime = now.getTime();
    const past = itinerary.map(eventAt).filter((time) => time <= currentTime);
    const nextIndex = itinerary.findIndex((item) => eventAt(item) > currentTime);
    const currentIndex = past.length ? itinerary.findIndex((item) => eventAt(item) === past[past.length - 1]) : -1;
    return { currentIndex, nextIndex, label: currentIndex >= 0 ? `いま：${itinerary[currentIndex]?.title}` : nextIndex >= 0 ? `次の予定：${itinerary[nextIndex]?.title}` : "予定を追加すると、現在地がここに表示されます" };
  }, [itinerary, now, tripDates.start]);

  // 旅程本体と担当者は1トランザクションで保存する。担当者だけが消える経路をなくすため。
  const saveItinerary = async (value: Draft, target: { id: string; version: number } | null) => {
    if (!supabase) return { status: "invalid" } as SaveResult;
    const { data, error } = await supabase.rpc("save_itinerary_item", {
      target_trip_id: tripId,
      target_item_id: target?.id ?? null,
      expected_version: target?.version ?? null,
      item_event_date: value.event_date,
      item_event_time: value.event_time || null,
      item_title: value.title.trim(),
      item_place: value.place.trim(),
      item_notes: value.notes.trim(),
      assignee_ids: value.assigneeIds,
    });
    if (error || !data) return { status: "invalid" } as SaveResult;
    return data as SaveResult;
  };
  const saveNewItinerary = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !draft.title.trim()) return; setSaving(true);
    const result = await saveItinerary(draft, null);
    if (result.status === "ok") { setDraft(blank(draft.event_date)); await load(); }
    else setStatus("旅程を保存できませんでした");
    setSaving(false);
  };
  const saveItineraryEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !editItinerary?.title.trim()) return; setSaving(true);
    const result = await saveItinerary(editItinerary, { id: editItinerary.id, version: editItinerary.version });
    if (result.status === "ok") { setEditItinerary(null); await load(); }
    else if (result.status === "conflict") { setEditItinerary(null); await load(CONFLICT_MESSAGE); }
    else setStatus("旅程を更新できませんでした");
    setSaving(false);
  };
  // 更新は該当0件でもエラーにならないため、返ってきた行の有無で競合を判定する。
  const savePacking = async (event: FormEvent, editing = false) => {
    event.preventDefault(); if (!supabase) return;
    if (editing) {
      const value = editPacking; if (!value?.name.trim()) return; setSaving(true);
      const { data, error } = await supabase.from("packing_items").update({ name: value.name.trim(), memo: value.memo.trim(), is_ready: value.is_ready }).eq("id", value.id).eq("version", value.version).select("id, version").maybeSingle();
      setSaving(false);
      if (error) { setStatus("持ち物を保存できませんでした"); return; }
      setEditPacking(null); await load(data ? undefined : CONFLICT_MESSAGE); return;
    }
    if (!packingDraft.name.trim()) return; setSaving(true);
    const { error } = await supabase.from("packing_items").insert({ trip_id: tripId, name: packingDraft.name.trim(), memo: packingDraft.memo.trim() });
    setSaving(false);
    if (error) { setStatus("持ち物を保存できませんでした"); return; }
    setPackingDraft({ name: "", memo: "" }); await load();
  };
  const saveNote = async (event: FormEvent, editing = false) => {
    event.preventDefault(); if (!supabase) return;
    if (editing) {
      const value = editNote; if (!value?.title.trim()) return; setSaving(true);
      const { data, error } = await supabase.from("shared_notes").update({ title: value.title.trim(), body: value.body.trim() }).eq("id", value.id).eq("version", value.version).select("id, version").maybeSingle();
      setSaving(false);
      if (error) { setStatus("メモを保存できませんでした"); return; }
      setEditNote(null); await load(data ? undefined : CONFLICT_MESSAGE); return;
    }
    if (!noteDraft.title.trim()) return; setSaving(true);
    const { error } = await supabase.from("shared_notes").insert({ trip_id: tripId, title: noteDraft.title.trim(), body: noteDraft.body.trim() });
    setSaving(false);
    if (error) { setStatus("メモを保存できませんでした"); return; }
    setNoteDraft({ title: "", body: "" }); await load();
  };
  // 削除は全員が使えるので、実行前に必ず確認する。誰がいつ消したかは change_logs に残る。
  const remove = async (table: "itinerary_items" | "packing_items" | "shared_notes", row: { id: string; version: number }, label: string, clear: () => void) => {
    if (!supabase || !window.confirm(`「${label}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    setSaving(true);
    const { data, error } = await supabase.from(table).delete().eq("id", row.id).eq("version", row.version).select("id").maybeSingle();
    setSaving(false);
    if (error) { setStatus("削除できませんでした"); return; }
    clear(); await load(data ? "削除しました" : CONFLICT_MESSAGE);
  };
  const itineraryFields = (value: Draft, setValue: (value: Draft) => void) => <>
    <div className="itinerary-time-fields"><label>日付<select value={value.event_date} onChange={(e) => setValue({ ...value, event_date: e.target.value })}>{dates.map((date) => <option key={date}>{date}</option>)}</select></label><label>時刻<input type="time" step="300" value={value.event_time} onChange={(e) => setValue({ ...value, event_time: e.target.value })} /></label></div>
    <label>予定名<input required value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} /></label><label>場所<input value={value.place} onChange={(e) => setValue({ ...value, place: e.target.value })} /></label>
    <fieldset><legend>担当する人</legend><div className="participant-options">{participants.map((person) => <label key={person.id}><input type="checkbox" checked={value.assigneeIds.includes(person.id)} onChange={() => setValue({ ...value, assigneeIds: toggle(value.assigneeIds, person.id) })} />{person.display_name}</label>)}</div></fieldset>
    <label>メモ<textarea value={value.notes} onChange={(e) => setValue({ ...value, notes: e.target.value })} /></label>
  </>;
  const show = (section: "itinerary" | "packing" | "notes") => focus === "itinerary" ? section === "itinerary" : section !== "itinerary";

  return <main className="shared-shell"><TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} /><p className="shared-kicker">{focus === "itinerary" ? "ITINERARY" : "PREPARATION"}</p><h1>{focus === "itinerary" ? "旅程" : "準備"}</h1><p className="shared-status" role="status">{status}</p>
    {show("itinerary") && <section id="itinerary" className="shared-panel confirmed-panel"><div className="shared-heading"><div><p>ITINERARY</p><h2>旅程</h2></div><span className="saved-badge">みんなに共有済み</span></div><div className="live-position"><span className="live-pulse" />{timelineState.label}<small>現在時刻 {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</small></div>
      <details className="add-drawer"><summary>＋ 予定を追加</summary><form className="draft-form" onSubmit={saveNewItinerary}>{itineraryFields(draft, setDraft)}<button className="save-button" disabled={saving}>この予定を保存</button></form></details>
      <div className="timeline">{itinerary.map((item, index) => { const isCurrent = index === timelineState.currentIndex; const isNext = index === timelineState.nextIndex; return <article className={`timeline-item ${isCurrent ? "is-current" : ""} ${isNext ? "is-next" : ""}`} key={item.id}><div className="timeline-time"><strong>{item.event_time?.slice(0, 5) || "未定"}</strong><span>{item.event_date?.replaceAll("-", "/")}</span></div><div className="timeline-dot" aria-hidden="true" /><div className="timeline-card">{isCurrent && <span className="timeline-state">いまここ</span>}{isNext && <span className="timeline-state next-state">次</span>}{editItinerary?.id === item.id ? <form className="draft-form editing-panel" onSubmit={saveItineraryEdit}><span className="editing-badge">編集中</span>{itineraryFields(editItinerary, (value) => setEditItinerary({ ...editItinerary, ...value }))}<div className="inline-actions"><button className="save-button" disabled={saving}>変更を保存</button><button type="button" onClick={() => setEditItinerary(null)}>キャンセル</button><button type="button" className="delete-action" disabled={saving} onClick={() => remove("itinerary_items", item, item.title, () => setEditItinerary(null))}>削除</button></div></form> : <><button className="edit-button" onClick={() => setEditItinerary({ id: item.id, version: item.version, event_date: item.event_date || tripDates.start, event_time: item.event_time?.slice(0, 5) || "", title: item.title, place: item.place, notes: item.notes, assigneeIds: selected(item.id) })}>編集</button><h3>{item.title}</h3>{item.place && <p className="timeline-place">{item.place}</p>}{item.notes && <p>{item.notes}</p>}<div className="assignee-chips">{selected(item.id).length ? selected(item.id).map((id) => <span key={id} style={{ background: people.get(id)?.avatar_color ?? "#e5efe7" }}>{people.get(id)?.display_name}</span>) : <span className="unassigned">担当者未設定</span>}</div></>}</div></article>; })}</div>{!itinerary.length && <p className="empty-state">まだ予定はありません。</p>}</section>}
    {show("packing") && <section id="packing" className="shared-panel confirmed-panel"><div className="shared-heading"><div><p>PACKING</p><h2>持ち物</h2></div><span className="saved-badge">みんなに共有済み</span></div>
      <details className="add-drawer"><summary>＋ 持ち物を追加</summary><form className="draft-form compact-form" onSubmit={(e) => savePacking(e)}><input required value={packingDraft.name} placeholder="持ち物名" onChange={(e) => setPackingDraft({ ...packingDraft, name: e.target.value })} /><input value={packingDraft.memo} placeholder="担当者・数量など" onChange={(e) => setPackingDraft({ ...packingDraft, memo: e.target.value })} /><button className="save-button" disabled={saving}>保存</button></form></details>
      {packing.map((item) => editPacking?.id === item.id ? <form className="draft-form editing-panel" key={item.id} onSubmit={(e) => savePacking(e, true)}><span className="editing-badge">編集中</span><input value={editPacking.name} onChange={(e) => setEditPacking({ ...editPacking, name: e.target.value })} /><input value={editPacking.memo} onChange={(e) => setEditPacking({ ...editPacking, memo: e.target.value })} /><label className="ready-toggle"><input type="checkbox" checked={editPacking.is_ready} onChange={(e) => setEditPacking({ ...editPacking, is_ready: e.target.checked })} />準備できた</label><div className="inline-actions"><button className="save-button" disabled={saving}>変更を保存</button><button type="button" onClick={() => setEditPacking(null)}>キャンセル</button><button type="button" className="delete-action" disabled={saving} onClick={() => remove("packing_items", item, item.name, () => setEditPacking(null))}>削除</button></div></form> : <div className="saved-row" key={item.id}><button className="edit-button" onClick={() => setEditPacking(item)}>編集</button><span className={`packing-state ${item.is_ready ? "ready" : "todo"}`}>{item.is_ready ? "準備済み" : "未準備"}</span><strong>{item.name}</strong><span>{item.memo}</span></div>)}{!packing.length && <p className="empty-state">まだ持ち物はありません。</p>}</section>}
    {show("notes") && <section id="notes" className="shared-panel confirmed-panel"><div className="shared-heading"><div><p>NOTES</p><h2>共有メモ</h2></div><span className="saved-badge">みんなに共有済み</span></div>
      <details className="add-drawer"><summary>＋ メモを追加</summary><form className="draft-form" onSubmit={(e) => saveNote(e)}><input required value={noteDraft.title} placeholder="メモの題名" onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} /><textarea value={noteDraft.body} placeholder="内容" onChange={(e) => setNoteDraft({ ...noteDraft, body: e.target.value })} /><button className="save-button" disabled={saving}>このメモを保存</button></form></details>
      {notes.map((item) => editNote?.id === item.id ? <form className="draft-form editing-panel" key={item.id} onSubmit={(e) => saveNote(e, true)}><span className="editing-badge">編集中</span><input value={editNote.title} onChange={(e) => setEditNote({ ...editNote, title: e.target.value })} /><textarea value={editNote.body} onChange={(e) => setEditNote({ ...editNote, body: e.target.value })} /><div className="inline-actions"><button className="save-button" disabled={saving}>変更を保存</button><button type="button" onClick={() => setEditNote(null)}>キャンセル</button><button type="button" className="delete-action" disabled={saving} onClick={() => remove("shared_notes", item, item.title, () => setEditNote(null))}>削除</button></div></form> : <div className="saved-row" key={item.id}><button className="edit-button" onClick={() => setEditNote(item)}>編集</button><strong>{item.title}</strong><span>{item.body}</span></div>)}{!notes.length && <p className="empty-state">まだ共有メモはありません。</p>}</section>}
    <TripTabs tripSlug={tripSlug} active={focus === "itinerary" ? "itinerary" : "prep"} />
  </main>;
}
