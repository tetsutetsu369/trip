"use client";

import { FormEvent, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Place = { id: string; name: string; map_url: string; version: number };
const empty = { name: "", map_url: "" };

export default function PlacesManager({ tripId }: { tripId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [places, setPlaces] = useState<Place[]>([]);
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<Place | null>(null);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);
  const load = async (message = "みんなに共有済み") => {
    if (!supabase) return;
    const { data, error } = await supabase.from("trip_places").select("id,name,map_url,version").eq("trip_id", tripId).order("name");
    if (error) { setStatus("場所を読み込めませんでした"); return; }
    setPlaces(data ?? []); setStatus(message);
  };
  useEffect(() => { void load(); }, [tripId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const currentEditing = editing;
    const current = currentEditing ?? draft;
    const name = current.name.trim();
    const mapUrl = current.map_url.trim();

    if (!supabase) { setStatus("保存できる接続がありません"); return; }
    if (!name) { setStatus("場所名を入力してください"); return; }
    if (!mapUrl) { setStatus("GoogleマップURLを入力してください"); return; }
    try {
      const url = new URL(mapUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        setStatus("GoogleマップURLはhttp(s)形式で入力してください");
        return;
      }
    } catch {
      setStatus("GoogleマップURLの形式を確認してください");
      return;
    }

    setSaving(true);
    setStatus("保存中…");
    const values = { name, map_url: mapUrl };
    try {
      const result = currentEditing
        ? await supabase.from("trip_places").update(values).eq("id", currentEditing.id).eq("version", currentEditing.version).select("id").maybeSingle()
        : await supabase.from("trip_places").insert({ trip_id: tripId, ...values }).select("id").maybeSingle();
      if (result.error || !result.data) { setStatus("他の人が先に更新したか、保存できませんでした"); return; }
      setEditing(null); setDraft(empty); await load(currentEditing ? "場所を更新しました" : "場所を追加しました");
    } catch {
      setStatus("保存に失敗しました。入力内容と権限を確認してください");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (place: Place) => {
    if (!supabase || !window.confirm(`「${place.name}」を削除しますか？`)) return; setSaving(true);
    const { error } = await supabase.from("trip_places").delete().eq("id", place.id).eq("version", place.version); setSaving(false);
    await load(error ? "予定から参照中の場所は削除できません" : "場所を削除しました");
  };
  const edit = (place: Place) => setEditing(place);
  const value = editing ?? draft;
  const setValue = (patch: Partial<typeof empty>) => editing ? setEditing({ ...editing, ...patch }) : setDraft({ ...draft, ...patch });
  return <section className="shared-panel places-panel"><div className="shared-heading"><div><p>PLACES</p><h2>場所とGoogleマップ</h2></div><span className="saved-badge" role="status" aria-live="polite">{status}</span></div><p className="finance-note">場所の名前とGoogleマップのリンクだけを共有します。旅程から同じ場所を選べます。</p><details className="add-drawer" open={Boolean(editing)}><summary>{editing ? "場所を編集" : "場所を追加"}</summary><form className="draft-form place-form" noValidate onSubmit={save}><label><span>場所名</span><input required value={value.name} placeholder="例：四国三郎の郷" onChange={(event) => setValue({ name: event.target.value })} /></label><label><span>GoogleマップURL</span><input required type="url" placeholder="https://maps.google.com/..." value={value.map_url} onChange={(event) => setValue({ map_url: event.target.value })} /></label><div className="inline-actions"><button className="save-button" disabled={saving}>{editing ? "変更を保存" : "場所を保存"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft(empty); }}>キャンセル</button>}</div></form></details><div className="place-list">{places.map((place) => <article className="place-card" key={place.id}><div><h3>{place.name}</h3></div><div className="place-links">{place.map_url ? <a href={place.map_url} target="_blank" rel="noreferrer">Googleマップを開く</a> : <span className="place-link-missing">GoogleマップURL未設定</span>}<button className="text-button" onClick={() => edit(place)}>編集</button><button className="text-button danger" onClick={() => void remove(place)} disabled={saving}>削除</button></div></article>)}</div>{!places.length && <p className="empty-state">場所はまだありません。</p>}</section>;
}
