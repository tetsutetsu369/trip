"use client";

import { ChangeEvent, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { type Plan, initialPlan, persistBudget, readBudget } from "@/shikoku-saburo-bbq-2026/budget-data";

// 年に数回の管理操作なので、費用画面ではなくここに置く。管理者にだけ表示される。
export default function BudgetBackup({ tripSlug }: { tripSlug: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return null;
    const { data: tripId, error } = await supabase.rpc("get_trip_id_by_slug", { target_slug: tripSlug });
    if (error || !tripId) return null;
    return { supabase, tripId: tripId as string };
  };

  const exportBackup = async () => {
    setBusy(true); setStatus("");
    const resolved = await resolve();
    const current = resolved ? await readBudget(resolved.supabase, resolved.tripId) : null;
    setBusy(false);
    if (!current) { setStatus("いまの費用データを読み込めませんでした"); return; }
    const blob = new Blob([JSON.stringify(current.plan ?? initialPlan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${tripSlug}-budget-backup.json`; link.click();
    URL.revokeObjectURL(url);
    setStatus("バックアップを書き出しました");
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let restored: Plan;
    try { restored = { ...initialPlan, ...JSON.parse(await file.text()) }; }
    catch { setStatus("バックアップファイルを読み込めませんでした"); return; }
    if (!window.confirm("いまの費用データを、このバックアップの内容で置き換えます。よろしいですか？")) return;

    setBusy(true); setStatus("");
    const resolved = await resolve();
    if (!resolved) { setBusy(false); setStatus("復元できませんでした"); return; }
    const current = await readBudget(resolved.supabase, resolved.tripId);
    const result = await persistBudget(resolved.supabase, resolved.tripId, restored, current?.version ?? null);
    setBusy(false);
    setStatus(result.status === "saved" ? "バックアップを復元し、みんなに共有しました" : result.status === "conflict" ? "他の人が先に保存していたため中止しました。もう一度お試しください" : "復元できませんでした");
  };

  return (
    <div className="backup-actions">
      <p>費用データの書き出しと、バックアップからの復元ができます。</p>
      <div>
        <button type="button" onClick={exportBackup} disabled={busy}>バックアップを書き出す</button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>バックアップから復元する</button>
      </div>
      <input ref={fileInput} hidden type="file" accept="application/json" onChange={restoreBackup} />
      {status && <p className="backup-status" role="status">{status}</p>}
    </div>
  );
}
