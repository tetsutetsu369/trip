"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Profile = { nickname: string; line_display_name: string; avatar_url: string | null; avatar_color: string | null; bio: string };

export default function ProfileEditor({ userId, profile }: { userId: string; profile: Profile }) {
  const [value, setValue] = useState(profile);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setStatus("");
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase?.from("profiles").update({ nickname: value.nickname.trim(), bio: value.bio.trim(), avatar_color: value.avatar_color }).eq("id", userId) ?? { error: new Error("Supabase未接続") };
    setSaving(false); setStatus(error ? "保存できませんでした" : "プロフィールを保存しました");
  };
  return <form className="profile-form" onSubmit={save}><div className="profile-avatar" style={{ background: value.avatar_color || "#e2793f" }}>{value.nickname.slice(0, 1) || "?"}</div><label>表示名<input required value={value.nickname} onChange={(e) => setValue({ ...value, nickname: e.target.value })} /></label><label>LINE表示名<span className="readonly-value">{value.line_display_name || "未設定"}</span></label><label>自己紹介<textarea value={value.bio} onChange={(e) => setValue({ ...value, bio: e.target.value })} placeholder="旅の仲間へのひとこと" /></label><label>アイコン色<input type="color" value={value.avatar_color || "#e2793f"} onChange={(e) => setValue({ ...value, avatar_color: e.target.value })} /></label><button className="save-button" disabled={saving}>{saving ? "保存中…" : "プロフィールを保存"}</button><Link className="profile-logout" href="/auth/logout">ログアウト</Link>{status && <p className="profile-status" role="status">{status}</p>}</form>;
}
