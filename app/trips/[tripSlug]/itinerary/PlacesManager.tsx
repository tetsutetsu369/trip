"use client";

import { FormEvent, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Place = { id: string; name: string; category: string; address: string; website_url: string; map_url: string; phone: string; opening_hours: string; memo: string; version: number };
const categories = [["lodging", "泊まる"], ["food", "食べる"], ["activity", "遊ぶ"], ["shopping", "買い出し"], ["transit", "移動"], ["other", "その他"]];
const empty = { name: "", category: "other", address: "", website_url: "", map_url: "", phone: "", opening_hours: "", memo: "" };

export default function PlacesManager({ tripId }: { tripId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [places, setPlaces] = useState<Place[]>([]);
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<Place | null>(null);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);
  const load = async (message = "みんなに共有済み") => {
    if (!supabase) return;
    const { data, error } = await supabase.from("trip_places").select("id,name,category,address,website_url,map_url,phone,opening_hours,memo,version").eq("trip_id", tripId).order("name");
    if (error) { setStatus("行き先を読み込めませんでした"); return; }
    setPlaces(data ?? []); setStatus(message);
  };
  useEffect(() => { void load(); }, [tripId]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !draft.name.trim()) return; setSaving(true);
    const values = { ...draft, name: draft.name.trim(), address: draft.address.trim(), website_url: draft.website_url.trim(), map_url: draft.map_url.trim(), phone: draft.phone.trim(), opening_hours: draft.opening_hours.trim(), memo: draft.memo.trim() };
    const result = editing
      ? await supabase.from("trip_places").update(values).eq("id", editing.id).eq("version", editing.version).select("id").maybeSingle()
      : await supabase.from("trip_places").insert({ trip_id: tripId, ...values }).select("id").maybeSingle();
    setSaving(false);
    if (result.error || !result.data) { setStatus("他の人が先に更新したか、保存できませんでした"); return; }
    setEditing(null); setDraft(empty); await load(editing ? "行き先を更新しました" : "行き先を追加しました");
  };
  const remove = async (place: Place) => {
    if (!supabase || !window.confirm(`「${place.name}」を削除しますか？`)) return; setSaving(true);
    const { error } = await supabase.from("trip_places").delete().eq("id", place.id).eq("version", place.version); setSaving(false);
    await load(error ? "予定から参照中の行き先は削除できません" : "行き先を削除しました");
  };
  const edit = (place: Place) => setEditing(place);
  const value = editing ?? draft;
  const setValue = (patch: Partial<typeof empty>) => editing ? setEditing({ ...editing, ...patch }) : setDraft({ ...draft, ...patch });
  return <section className="shared-panel places-panel"><div className="shared-heading"><div><p>PLACES</p><h2>行き先一覧</h2></div><span className="saved-badge">{status}</span></div><p className="finance-note">同じ場所を複数の予定から参照できます。公式サイトや地図もここにまとめます。</p><details className="add-drawer" open={Boolean(editing)}><summary>{editing ? "行き先を編集" : "行き先を追加"}</summary><form className="draft-form place-form" onSubmit={save}><div className="fields"><label className="field"><span>名前</span><input required value={value.name} onChange={(event) => setValue({ name: event.target.value })} /></label><label className="field"><span>種別</span><select value={value.category} onChange={(event) => setValue({ category: event.target.value })}>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>住所</span><input value={value.address} onChange={(event) => setValue({ address: event.target.value })} /></label><label className="field"><span>電話</span><input value={value.phone} onChange={(event) => setValue({ phone: event.target.value })} /></label><label className="field"><span>公式サイト</span><input type="url" value={value.website_url} onChange={(event) => setValue({ website_url: event.target.value })} /></label><label className="field"><span>地図URL</span><input type="url" value={value.map_url} onChange={(event) => setValue({ map_url: event.target.value })} /></label></div><label>営業時間<input value={value.opening_hours} onChange={(event) => setValue({ opening_hours: event.target.value })} /></label><label>メモ<textarea value={value.memo} onChange={(event) => setValue({ memo: event.target.value })} /></label><div className="inline-actions"><button className="save-button" disabled={saving}>{editing ? "変更を保存" : "行き先を保存"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft(empty); }}>キャンセル</button>}</div></form></details><div className="place-list">{places.map((place) => <article className="place-card" key={place.id}><div><span className="place-kind">{categories.find(([key]) => key === place.category)?.[1] ?? "その他"}</span><h3>{place.name}</h3><p>{place.address || "住所未設定"}</p>{place.phone && <p>{place.phone}</p>}{place.opening_hours && <p>{place.opening_hours}</p>}</div><div className="place-links">{place.website_url && <a href={place.website_url} target="_blank" rel="noreferrer">公式サイト</a>}{place.map_url && <a href={place.map_url} target="_blank" rel="noreferrer">地図</a>}<button className="text-button" onClick={() => edit(place)}>編集</button><button className="text-button danger" onClick={() => void remove(place)} disabled={saving}>削除</button></div></article>)}</div>{!places.length && <p className="empty-state">行き先はまだありません。</p>}</section>;
}
