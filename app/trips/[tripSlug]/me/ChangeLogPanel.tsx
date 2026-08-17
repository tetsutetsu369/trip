"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type ChangeLog = { id: string; actor_user_id: string | null; table_name: string; action: string; changed_fields: Record<string, unknown>; created_at: string };

const tableLabel: Record<string, string> = { itinerary_items: "旅程", packing_items: "持ち物", shared_notes: "共有メモ", expenses: "費用", expense_shares: "負担額", settlements: "精算", trip_places: "場所", trip_settings: "費用設定" };
const actionLabel: Record<string, string> = { insert: "追加", update: "更新", delete: "削除", restore: "復元" };

export default function ChangeLogPanel({ tripId }: { tripId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [names, setNames] = useState(new Map<string, string>());
  const [status, setStatus] = useState("読み込み中…");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!supabase) return;
      const result = await supabase.from("change_logs").select("id,actor_user_id,table_name,action,changed_fields,created_at").eq("trip_id", tripId).order("created_at", { ascending: false }).limit(20);
      if (result.error) { if (!cancelled) setStatus("変更履歴を読み込めませんでした"); return; }
      const actorIds = [...new Set((result.data ?? []).map((log) => log.actor_user_id).filter((id): id is string => Boolean(id)))];
      const profileResult = actorIds.length ? await supabase.from("profiles").select("id,nickname,line_display_name").in("id", actorIds) : { data: [], error: null };
      if (cancelled) return;
      setLogs(result.data ?? []); setNames(new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.nickname || profile.line_display_name || "参加者"]))); setStatus("最新20件");
    };
    void load(); return () => { cancelled = true; };
  }, [tripId]);
  return <section className="profile-card change-log-panel"><div className="shared-heading"><div><p className="auth-eyebrow">AUDIT TRAIL</p><h2>変更履歴</h2></div><span className="saved-badge">{status}</span></div>{logs.length ? <div className="change-log-list">{logs.map((log) => <article key={log.id}><div><strong>{tableLabel[log.table_name] ?? log.table_name}</strong><span>{actionLabel[log.action] ?? log.action}｜{names.get(log.actor_user_id ?? "") ?? "不明なユーザー"}</span></div><time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}</time></article>)}</div> : <p className="empty-state">変更履歴はまだありません。</p>}</section>;
}
