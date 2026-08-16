"use client";

import { FormEvent, type CSSProperties, useEffect, useMemo, useState } from "react";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import PlacesManager from "../itinerary/PlacesManager";

// 「準備」は持ち物とメモを1画面に統合したタブ。
type Focus = "itinerary" | "prep";
type Person = { id: string; display_name: string; avatar_color: string | null };
type Itinerary = { id: string; event_date: string | null; event_time: string | null; title: string; place: string; place_id: string | null; group_label: string; notes: string; sort_order: number; version: number };
type Packing = { id: string; name: string; memo: string; is_ready: boolean; version: number };
type Note = { id: string; title: string; body: string; version: number };
type Place = { id: string; name: string; map_url: string };
type Assignment = { itinerary_item_id: string; participant_id: string };
type Draft = { event_date: string; event_time: string; title: string; place: string; place_id: string | null; notes: string; assigneeIds: string[] };

type SaveResult = { status: "ok" | "conflict" | "forbidden" | "invalid"; id?: string; version?: number };

const DEFAULT_GROUP_LABEL = "全員";
const normalizeGroupLabel = (label: string | null | undefined) => label?.trim() || DEFAULT_GROUP_LABEL;
const blank = (date: string, assigneeIds: string[] = []): Draft => ({ event_date: date, event_time: "", title: "", place: "", place_id: null, notes: "", assigneeIds });
const CONFLICT_MESSAGE = "他の人が先に保存しました。最新を読み込みます";
const hasAllParticipants = (ids: string[], participantIds: string[]) => participantIds.length > 0 && participantIds.every((id) => ids.includes(id));
const participantGroupKey = (ids: string[], participantIds: string[]) => {
  const knownIds = participantIds.filter((id) => ids.includes(id));
  if (hasAllParticipants(knownIds, participantIds)) return "all-participants";
  if (!knownIds.length) return "unassigned";
  return knownIds.slice().sort().join("|");
};
const participantGroupLabel = (ids: string[], participantIds: string[], people: Map<string, Person>) => {
  const knownIds = participantIds.filter((id) => ids.includes(id));
  if (hasAllParticipants(knownIds, participantIds)) return DEFAULT_GROUP_LABEL;
  if (!knownIds.length) return "担当者未設定";
  return knownIds.map((id) => people.get(id)?.display_name).filter(Boolean).join("・") || "担当者未設定";
};

export default function SharedTripPage({
  tripId, tripSlug, tripName, tripDates, participants, avatarUrl = null, focus,
}: { tripId: string; tripSlug: string; tripName: string; tripDates: { start: string; end: string }; participants: Person[]; avatarUrl?: string | null; focus: Focus }) {
  const supabase = createBrowserSupabaseClient();
  const dates = [tripDates.start, tripDates.end];
  const people = useMemo(() => new Map(participants.map((person) => [person.id, person])), [participants]);
  const participantIds = useMemo(() => participants.map((person) => person.id), [participants]);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [packing, setPacking] = useState<Packing[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blank(tripDates.start, participantIds));
  const [packingDraft, setPackingDraft] = useState({ name: "", memo: "" });
  const [noteDraft, setNoteDraft] = useState({ title: "", body: "" });
  const [editItinerary, setEditItinerary] = useState<(Draft & { id: string; version: number }) | null>(null);
  const [editPacking, setEditPacking] = useState<Packing | null>(null);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("読み込み中…");
  const [now, setNow] = useState(() => new Date());
  const [itineraryView, setItineraryView] = useState<"timeline" | "groups">("timeline");
  const [selectedGroupKey, setSelectedGroupKey] = useState("all");

  const load = async (message = "みんなに共有済み") => {
    if (!supabase) return;
    const [i, p, n, placesResult] = await Promise.all([
      supabase.from("itinerary_items").select("id,event_date,event_time,title,place,place_id,group_label,notes,sort_order,version").eq("trip_id", tripId),
      supabase.from("packing_items").select("id,name,memo,is_ready,version").eq("trip_id", tripId).order("created_at"),
      supabase.from("shared_notes").select("id,title,body,version").eq("trip_id", tripId).order("updated_at", { ascending: false }),
      supabase.from("trip_places").select("id,name,map_url").eq("trip_id", tripId).order("name"),
    ]);
    if (i.error || p.error || n.error || placesResult.error) { setStatus("読み込めませんでした"); return; }
    const items = [...(i.data ?? [])].sort((a, b) => `${a.event_date ?? "9999"}${a.event_time ?? "99"}`.localeCompare(`${b.event_date ?? "9999"}${b.event_time ?? "99"}`) || a.sort_order - b.sort_order);
    const a = items.length ? await supabase.from("itinerary_assignees").select("itinerary_item_id,participant_id").in("itinerary_item_id", items.map((item) => item.id)) : { data: [], error: null };
    if (a.error) { setStatus("担当者データを読み込めませんでした"); return; }
    setItinerary(items); setPlaces(placesResult.data ?? []); setPacking(p.data ?? []); setNotes(n.data ?? []); setAssignments(a.data ?? []); setStatus(message);
  };
  useEffect(() => { void load(); }, [tripId]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);

  const selected = (id: string) => assignments.filter((a) => a.itinerary_item_id === id).map((a) => a.participant_id);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  const itineraryGroupData = useMemo(() => {
    const byItemId = new Map<string, { key: string; label: string }>();
    const groups = new Map<string, { key: string; label: string; count: number }>();
    itinerary.forEach((item) => {
      const assigneeIds = assignments.filter((assignment) => assignment.itinerary_item_id === item.id).map((assignment) => assignment.participant_id);
      const group = assigneeIds.some((id) => participantIds.includes(id))
        ? { key: participantGroupKey(assigneeIds, participantIds), label: participantGroupLabel(assigneeIds, participantIds, people) }
        : (() => {
          // group_label is kept only as a fallback for itinerary data created before groups were unified.
          const legacyLabel = normalizeGroupLabel(item.group_label);
          return { key: legacyLabel === DEFAULT_GROUP_LABEL ? "all-participants" : `legacy:${legacyLabel}`, label: legacyLabel };
        })();
      byItemId.set(item.id, group);
      const current = groups.get(group.key);
      groups.set(group.key, { key: group.key, label: group.label, count: (current?.count ?? 0) + 1 });
    });
    return { byItemId, groups: Array.from(groups.values()) };
  }, [assignments, itinerary, participantIds, people]);
  const itineraryGroups = itineraryGroupData.groups;
  const itemGroup = (item: Itinerary) => itineraryGroupData.byItemId.get(item.id) ?? { key: "unassigned", label: "担当者未設定" };
  useEffect(() => {
    if (selectedGroupKey !== "all" && !itineraryGroups.some((group) => group.key === selectedGroupKey)) setSelectedGroupKey("all");
  }, [itineraryGroups, selectedGroupKey]);
  const locationForItem = (item: Itinerary) => {
    const place = item.place_id ? places.find((candidate) => candidate.id === item.place_id) : null;
    return (place?.name || item.place).trim();
  };
  const routeUrlForItems = (items: Itinerary[]) => {
    const eventDates = new Set(items.map((item) => item.event_date ?? tripDates.start));
    if (eventDates.size !== 1) return null;
    const locations = Array.from(new Set(items.map(locationForItem).filter(Boolean)));
    if (locations.length < 2 || locations.length > 4) return null;
    const params = new URLSearchParams({ api: "1", origin: locations[0], destination: locations[locations.length - 1], travelmode: "driving" });
    const waypoints = locations.slice(1, -1);
    if (waypoints.length) params.set("waypoints", waypoints.join("|"));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  };
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
    const { data, error } = await supabase.rpc("save_itinerary_item_with_place", {
      target_trip_id: tripId,
      target_item_id: target?.id ?? null,
      expected_version: target?.version ?? null,
      item_event_date: value.event_date,
      item_event_time: value.event_time || null,
      item_title: value.title.trim(),
      item_place: value.place.trim(),
      item_place_id: value.place_id,
      item_group_label: participantGroupLabel(value.assigneeIds, participantIds, people),
      item_notes: value.notes.trim(),
      assignee_ids: value.assigneeIds,
    });
    if (error || !data) return { status: "invalid" } as SaveResult;
    return data as SaveResult;
  };
  const saveNewItinerary = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !draft.title.trim()) return; setSaving(true);
    const result = await saveItinerary(draft, null);
    if (result.status === "ok") { setDraft(blank(draft.event_date, participantIds)); await load(); }
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
  const togglePacking = async (item: Packing) => {
    if (!supabase || saving) return;
    const nextReady = !item.is_ready;
    setPacking((current) => current.map((row) => row.id === item.id ? { ...row, is_ready: nextReady } : row));
    setSaving(true);
    const { data, error } = await supabase.from("packing_items").update({ is_ready: nextReady }).eq("id", item.id).eq("version", item.version).select("id, version").maybeSingle();
    setSaving(false);
    if (error) { await load("持ち物の状態を更新できませんでした"); return; }
    await load(data ? (nextReady ? "準備済みにしました" : "未準備に戻しました") : CONFLICT_MESSAGE);
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
    <label>予定名<input required value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} /></label><label>行き先<select value={value.place_id ?? ""} onChange={(e) => { const place = places.find((item) => item.id === e.target.value); setValue({ ...value, place_id: e.target.value || null, place: place?.name ?? value.place }); }}><option value="">行き先を選択（任意）</option>{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label><label>場所メモ<input value={value.place} onChange={(e) => setValue({ ...value, place: e.target.value })} /></label>
    <fieldset className="itinerary-group-field"><legend>行動グループ（担当者）</legend><p className="field-hint">同じ人の組み合わせを選んだ予定は、同じグループにまとまります。</p><div className="participant-options"><label className="participant-option-all"><input type="checkbox" checked={hasAllParticipants(value.assigneeIds, participantIds)} onChange={(e) => setValue({ ...value, assigneeIds: e.target.checked ? participantIds : [] })} />全員</label>{participants.map((person) => <label key={person.id}><input type="checkbox" checked={value.assigneeIds.includes(person.id)} onChange={() => setValue({ ...value, assigneeIds: toggle(value.assigneeIds, person.id) })} />{person.display_name}</label>)}</div></fieldset>
    <label>メモ<textarea value={value.notes} onChange={(e) => setValue({ ...value, notes: e.target.value })} /></label>
  </>;
  const renderItineraryItem = (item: Itinerary, compact = false) => {
    const isCurrent = item.id === itinerary[timelineState.currentIndex]?.id;
    const isNext = item.id === itinerary[timelineState.nextIndex]?.id;
    const groupLabel = itemGroup(item).label;
    const place = item.place_id ? places.find((candidate) => candidate.id === item.place_id) : null;
    return <article className={`timeline-item ${compact ? "timeline-item-compact" : ""} ${isCurrent ? "is-current" : ""} ${isNext ? "is-next" : ""}`} key={item.id}>
      <div className="timeline-time"><strong>{item.event_time?.slice(0, 5) || "未定"}</strong><span>{item.event_date?.replaceAll("-", "/")}</span></div><div className="timeline-dot" aria-hidden="true" />
      <div className="timeline-card">{isCurrent && <span className="timeline-state">いまここ</span>}{isNext && <span className="timeline-state next-state">次</span>}
        {editItinerary?.id === item.id ? <form className="draft-form editing-panel" onSubmit={saveItineraryEdit}><span className="editing-badge">編集中</span>{itineraryFields(editItinerary, (value) => setEditItinerary({ ...editItinerary, ...value }))}<div className="inline-actions"><button className="save-button" disabled={saving}>変更を保存</button><button type="button" onClick={() => setEditItinerary(null)}>キャンセル</button><button type="button" className="delete-action" disabled={saving} onClick={() => remove("itinerary_items", item, item.title, () => setEditItinerary(null))}>削除</button></div></form> : <>
          <button className="edit-button" onClick={() => setEditItinerary({ id: item.id, version: item.version, event_date: item.event_date || tripDates.start, event_time: item.event_time?.slice(0, 5) || "", title: item.title, place: item.place, place_id: item.place_id, notes: item.notes, assigneeIds: selected(item.id) })}>編集</button>
          <div className="timeline-card-labels"><span className={`itinerary-group-badge ${groupLabel === DEFAULT_GROUP_LABEL ? "is-common" : ""}`}>{groupLabel}</span></div>
          <h3>{item.title}</h3>{place && <p className="timeline-place">{place.name}</p>}{!place && item.place && <p className="timeline-place">{item.place}</p>}{place?.map_url && <a className="timeline-map-link" href={place.map_url} target="_blank" rel="noreferrer">Googleマップを開く</a>}{item.notes && <p>{item.notes}</p>}<div className="assignee-chips">{selected(item.id).length ? selected(item.id).map((id) => <span key={id} style={{ "--assignee-color": people.get(id)?.avatar_color ?? "#55a99f" } as CSSProperties}>{people.get(id)?.display_name}</span>) : <span className="unassigned">担当者未設定</span>}</div>
        </>}
      </div>
    </article>;
  };
  const renderGroupedItinerary = () => {
    const visibleGroups = itineraryGroups.filter((group) => selectedGroupKey === "all" || group.key === selectedGroupKey);
    return <div className="itinerary-group-list">{visibleGroups.map((group) => {
      const items = itinerary.filter((item) => itemGroup(item).key === group.key);
      const routeUrl = routeUrlForItems(items);
      return <section className="itinerary-group-lane" key={group.key}><div className="itinerary-group-heading"><div><span className={`itinerary-group-badge ${group.label === DEFAULT_GROUP_LABEL ? "is-common" : ""}`}>{group.label}</span><strong>{group.label === DEFAULT_GROUP_LABEL ? "全員の予定" : `${group.label}の予定`}</strong></div><div className="itinerary-group-actions"><small>{items.length}件</small>{routeUrl && <a href={routeUrl} target="_blank" rel="noreferrer">ルートを開く</a>}</div></div><div className="timeline timeline-group-lane-items">{items.map((item) => renderItineraryItem(item, true))}</div></section>;
    })}</div>;
  };
  const show = (section: "itinerary" | "packing" | "notes") => focus === "itinerary" ? section === "itinerary" : section !== "itinerary";

  return <main className="shared-shell"><TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} /><p className="shared-kicker">{focus === "itinerary" ? "ITINERARY" : "PREPARATION"}</p><h1>{focus === "itinerary" ? "旅程" : "準備"}</h1><p className="shared-status" role="status">{status}</p>
    {show("itinerary") && <section id="itinerary" className="shared-panel confirmed-panel"><div className="shared-heading"><div><p>ITINERARY</p><h2>旅程</h2></div><span className="saved-badge">みんなに共有済み</span></div><div className="live-position"><span className="live-pulse" />{timelineState.label}<small>現在時刻 {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</small></div>
      <details className="add-drawer"><summary>＋ 予定を追加</summary><form className="draft-form" onSubmit={saveNewItinerary}>{itineraryFields(draft, setDraft)}<button className="save-button" disabled={saving}>この予定を保存</button></form></details>
      <div className="itinerary-view-toolbar"><div className="itinerary-view-controls" role="tablist" aria-label="旅程の表示方法"><button type="button" role="tab" aria-selected={itineraryView === "timeline"} className={itineraryView === "timeline" ? "is-active" : ""} onClick={() => setItineraryView("timeline")}>全体表示</button><button type="button" role="tab" aria-selected={itineraryView === "groups"} className={itineraryView === "groups" ? "is-active" : ""} onClick={() => setItineraryView("groups")}>班別表示</button></div>{itineraryView === "groups" && <label className="itinerary-group-filter">表示するグループ<select value={selectedGroupKey} onChange={(e) => setSelectedGroupKey(e.target.value)}><option value="all">すべてのグループ</option>{itineraryGroups.map((group) => <option key={group.key} value={group.key}>{group.label}（{group.count}件）</option>)}</select></label>}</div>
      {itineraryView === "timeline" ? <div className="timeline">{itinerary.map((item) => renderItineraryItem(item))}</div> : renderGroupedItinerary()}{!itinerary.length && <p className="empty-state">まだ予定はありません。</p>}</section>}
    {show("packing") && <section id="packing" className="shared-panel confirmed-panel"><div className="shared-heading"><div><p>PACKING</p><h2>持ち物</h2></div><span className="saved-badge">みんなに共有済み</span></div>
      <details className="add-drawer"><summary>＋ 持ち物を追加</summary><form className="draft-form compact-form" onSubmit={(e) => savePacking(e)}><input required value={packingDraft.name} placeholder="持ち物名" onChange={(e) => setPackingDraft({ ...packingDraft, name: e.target.value })} /><input value={packingDraft.memo} placeholder="担当者・数量など" onChange={(e) => setPackingDraft({ ...packingDraft, memo: e.target.value })} /><button className="save-button" disabled={saving}>保存</button></form></details>
      {packing.map((item) => editPacking?.id === item.id ? <form className="draft-form editing-panel" key={item.id} onSubmit={(e) => savePacking(e, true)}><span className="editing-badge">編集中</span><input value={editPacking.name} onChange={(e) => setEditPacking({ ...editPacking, name: e.target.value })} /><input value={editPacking.memo} onChange={(e) => setEditPacking({ ...editPacking, memo: e.target.value })} /><label className="ready-toggle"><input type="checkbox" checked={editPacking.is_ready} onChange={(e) => setEditPacking({ ...editPacking, is_ready: e.target.checked })} />準備できた</label><div className="inline-actions"><button className="save-button" disabled={saving}>変更を保存</button><button type="button" onClick={() => setEditPacking(null)}>キャンセル</button><button type="button" className="delete-action" disabled={saving} onClick={() => remove("packing_items", item, item.name, () => setEditPacking(null))}>削除</button></div></form> : <div className="saved-row packing-row" key={item.id}><label className="packing-check"><input type="checkbox" checked={item.is_ready} onChange={() => void togglePacking(item)} disabled={saving} /><span className={`packing-state ${item.is_ready ? "ready" : "todo"}`}>{item.is_ready ? "準備済み" : "未準備"}</span></label><div className="packing-copy"><strong>{item.name}</strong>{item.memo && <span>{item.memo}</span>}</div><button className="edit-button" onClick={() => setEditPacking(item)}>編集</button></div>)}{!packing.length && <p className="empty-state">まだ持ち物はありません。</p>}</section>}
    {show("notes") && <section id="notes" className="shared-panel confirmed-panel"><div className="shared-heading"><div><p>NOTES</p><h2>共有メモ</h2></div><span className="saved-badge">みんなに共有済み</span></div>
      <details className="add-drawer"><summary>＋ メモを追加</summary><form className="draft-form" onSubmit={(e) => saveNote(e)}><input required value={noteDraft.title} placeholder="メモの題名" onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} /><textarea value={noteDraft.body} placeholder="内容" onChange={(e) => setNoteDraft({ ...noteDraft, body: e.target.value })} /><button className="save-button" disabled={saving}>このメモを保存</button></form></details>
      {notes.map((item) => editNote?.id === item.id ? <form className="draft-form editing-panel" key={item.id} onSubmit={(e) => saveNote(e, true)}><span className="editing-badge">編集中</span><input value={editNote.title} onChange={(e) => setEditNote({ ...editNote, title: e.target.value })} /><textarea value={editNote.body} onChange={(e) => setEditNote({ ...editNote, body: e.target.value })} /><div className="inline-actions"><button className="save-button" disabled={saving}>変更を保存</button><button type="button" onClick={() => setEditNote(null)}>キャンセル</button><button type="button" className="delete-action" disabled={saving} onClick={() => remove("shared_notes", item, item.title, () => setEditNote(null))}>削除</button></div></form> : <div className="saved-row" key={item.id}><button className="edit-button" onClick={() => setEditNote(item)}>編集</button><strong>{item.title}</strong><span>{item.body}</span></div>)}{!notes.length && <p className="empty-state">まだ共有メモはありません。</p>}</section>}
    {focus === "itinerary" && <PlacesManager tripId={tripId} />}
    <TripTabs tripSlug={tripSlug} active={focus === "itinerary" ? "itinerary" : "prep"} />
  </main>;
}
