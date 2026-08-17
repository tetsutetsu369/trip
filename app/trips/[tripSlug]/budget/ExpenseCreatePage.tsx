"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import ExpenseEditor, { createNewExpenseDraft, type BudgetPerson, type ExpenseSavePayload, type ExpenseSaveResult, type Itinerary } from "./ExpenseEditor";

const budgetSettingsOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export default function ExpenseCreatePage({ tripId, tripSlug, tripName, avatarUrl = null }: { tripId: string; tripSlug: string; tripName: string; avatarUrl?: string | null }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [people, setPeople] = useState<BudgetPerson[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);
  const targetPeople = useMemo(() => people.filter((person) => targetIds.includes(person.id)), [people, targetIds]);
  const initialDraft = useMemo(() => createNewExpenseDraft(targetPeople), [targetPeople]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase) return;
      const [settingsResult, participantResult, itineraryResult] = await Promise.all([
        supabase.from("trip_settings").select("budget").eq("trip_id", tripId).maybeSingle<{ budget: Record<string, unknown> | null }>(),
        supabase.from("trip_participants").select("id,display_name,profile_id").eq("trip_id", tripId).order("created_at"),
        supabase.from("itinerary_items").select("id,event_date,event_time,title,place,travel_origin,travel_destination,travel_distance_km,travel_estimated_cost,travel_mode").eq("trip_id", tripId).order("event_date").order("event_time"),
      ]);
      if (!active) return;
      if (settingsResult.error || participantResult.error || itineraryResult.error) { setStatus("費用入力の準備に失敗しました"); return; }
      const nextPeople: BudgetPerson[] = (participantResult.data ?? []).map((person) => ({ id: person.id, name: person.display_name, profile_id: person.profile_id }));
      const budget = budgetSettingsOf(settingsResult.data?.budget);
      const savedScope = Array.isArray(budget.settlementParticipantIds) ? budget.settlementParticipantIds : budget.budgetParticipantIds;
      const resolvedIds = Array.isArray(savedScope) ? savedScope.map((id) => typeof id === "string" ? nextPeople.find((person) => person.id === id || person.profile_id === id)?.id : null).filter((id): id is string => Boolean(id)) : nextPeople.map((person) => person.id);
      setPeople(nextPeople);
      setTargetIds(resolvedIds.length ? resolvedIds : nextPeople.map((person) => person.id));
      setItinerary(itineraryResult.data ?? []);
      setReady(true);
      setStatus("入力できます");
    };
    void load();
    return () => { active = false; };
  }, [tripId]);

  const saveExpense = async (payload: ExpenseSavePayload): Promise<ExpenseSaveResult> => {
    if (!supabase || payload.id || !payload.items.length) return { ok: false, message: "新しい費用を保存できませんでした" };
    setSaving(true);
    const result = await supabase.rpc("create_expense_batch_with_shares", { target_trip_id: tripId, input_transaction_id: null, input_merchant_name: payload.merchant_name, input_purchased_on: payload.purchased_on, input_itinerary_item_id: payload.itinerary_item_id, input_payment_status: payload.payment_status, input_payer_id: payload.payer_id, input_allocation_method: payload.allocation_method, input_share_user_ids: payload.selected_ids, input_items: payload.items, input_memo: payload.memo });
    setSaving(false);
    const resultStatus = (result.data as { status?: string } | null)?.status;
    if (result.error || resultStatus !== "ok") {
      const message = resultStatus === "payer_required" ? "支払済みの場合は支払者を選択してください" : "新しい費用を保存できませんでした";
      setStatus(message);
      return { ok: false, message };
    }
    router.push("/trips/" + tripSlug + "/budget");
    return { ok: true };
  };

  return <main className="budget-shell finance-shell">
    <TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} />
    <p className="save-status" role="status">{status}</p>
    <section className="budget-hero"><p className="kicker">COST ENTRY</p><h1>費用を追加</h1><p>{tripName}</p></section>
    <section className="panel finance-panel expense-create-panel">
      <div className="expense-page-header"><div><h2>新しい費用を登録</h2><p>支払い前の予定・支払済みの実績・明細ごとの税率をまとめて入力できます。</p></div><Link className="expense-back-link" href={"/trips/" + tripSlug + "/budget"}>← 費用一覧に戻る</Link></div>
      {!ready ? <p className="empty-state">入力項目を準備しています…</p> : <ExpenseEditor initialDraft={initialDraft} people={targetPeople} itinerary={itinerary} saving={saving} onSave={saveExpense} onCancel={() => router.push("/trips/" + tripSlug + "/budget")} />}
    </section>
    <TripTabs tripSlug={tripSlug} active="budget" />
  </main>;
}
