"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import ExpenseEditor, { amountOf, categories, categoryLabel, createExpenseDraft, decimalOf, money, type BudgetPerson, type ExpenseRecord, type ExpenseSavePayload, type ExpenseSaveResult, type ExpenseShare, type Itinerary } from "./ExpenseEditor";

type Expense = ExpenseRecord;
type Share = ExpenseShare;
type Settlement = { id: string; from_id: string; to_id: string; amount: number; status: string };
type SettlementRow = { id: string; paidAmount: number; burdenAmount: number; before: number; remaining: number };
type SettlementData = { rows: SettlementRow[]; suggestions: { from: string; to: string; amount: number }[]; incompleteExpenses: { id: string; title: string; amount: number; reason: string }[]; unassignedPaid: number };

const displayNumber = (value: number) => value === 0 ? "" : value;
const budgetSettingsOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const storedMap = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, amountOf(amount)])) : {} as Record<string, number>;
const storedCategoryMap = (settings: Record<string, unknown>) => storedMap(settings.categoryBudgets);
const expenseForecast = (expense: Expense) => expense.payment_status === "paid" ? amountOf(expense.amount) : amountOf(expense.planned_amount);

export default function FinancePage({ tripId, tripSlug, tripName, avatarUrl = null, userId }: { tripId: string; tripSlug: string; tripName: string; avatarUrl?: string | null; userId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [budgetPeople, setBudgetPeople] = useState<BudgetPerson[]>([]);
  const [financeParticipantIds, setFinanceParticipantIds] = useState<string[]>([]);
  const [participantBudgets, setParticipantBudgets] = useState<Record<string, number>>({});
  const [budgetPerPerson, setBudgetPerPerson] = useState(0);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [fuelPrice, setFuelPrice] = useState(175);
  const [fuelEfficiency, setFuelEfficiency] = useState(18);
  const [settingsVersion, setSettingsVersion] = useState<number | null>(null);
  const [budgetReady, setBudgetReady] = useState(false);
  const [budgetDirty, setBudgetDirty] = useState(false);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string | null) => budgetPeople.find((person) => person.id === id)?.name ?? "未設定";
  const itineraryLabel = (item: Itinerary) => {
    const route = [item.travel_origin, item.travel_destination].filter(Boolean).join(" → ");
    return route || [item.event_date?.replaceAll("-", "/"), item.event_time?.slice(0, 5), item.title, item.place].filter(Boolean).join("｜");
  };
  const load = async (message = "みんなに共有済み") => {
    if (!supabase) return;
    const [settingsResult, expenseResult, shareResult, settlementResult, participantResult, itineraryResult] = await Promise.all([
      supabase.from("trip_settings").select("budget,version").eq("trip_id", tripId).maybeSingle<{ budget: Record<string, unknown> | null; version: number }>(),
      supabase.from("expenses").select("id,transaction_id,merchant_name,purchased_on,itinerary_item_id,title,category,net_amount,tax_rate,tax_amount,planned_amount,amount,payer_participant_id,payment_status,settlement_status,allocation_method,memo,version").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("expense_shares").select("expense_id,participant_id,amount"),
      supabase.from("settlements").select("id,from_participant_id,to_participant_id,amount,status").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("trip_participants").select("id,display_name,profile_id").eq("trip_id", tripId).order("created_at"),
      supabase.from("itinerary_items").select("id,event_date,event_time,title,place,travel_origin,travel_destination,travel_distance_km,travel_estimated_cost,travel_mode").eq("trip_id", tripId).order("event_date").order("event_time"),
    ]);
    if (settingsResult.error || expenseResult.error || shareResult.error || settlementResult.error || participantResult.error || itineraryResult.error) { setStatus("費用データを読み込めませんでした"); return; }
    const savedBudget = budgetSettingsOf(settingsResult.data?.budget);
    const savedBudgetPeople: BudgetPerson[] = (participantResult.data ?? []).map((person) => ({ id: person.id, name: person.display_name, profile_id: person.profile_id }));
    const resolveSavedParticipants = (value: unknown, fallback: string[]) => Array.isArray(value) ? value.map((id) => typeof id === "string" ? savedBudgetPeople.find((person) => person.id === id || person.profile_id === id)?.id : null).filter((id): id is string => Boolean(id)) : fallback;
    const savedScope = Array.isArray(savedBudget.settlementParticipantIds) ? savedBudget.settlementParticipantIds : savedBudget.budgetParticipantIds;
    const savedFinanceParticipantIds = resolveSavedParticipants(savedScope, savedBudgetPeople.map((person) => person.id));
    const savedParticipantBudgets = storedMap(savedBudget.participantBudgets);
    const legacyPerPerson = amountOf(savedBudget.budgetPerPerson);
    const initialBudgets = Object.keys(savedParticipantBudgets).length ? savedParticipantBudgets : legacyPerPerson ? Object.fromEntries(savedBudgetPeople.map((person) => [person.id, legacyPerPerson])) : {};
    const initialValues = Object.values(initialBudgets);
    setBudgetPeople(savedBudgetPeople);
    setFinanceParticipantIds(savedFinanceParticipantIds);
    setParticipantBudgets(initialBudgets);
    setBudgetPerPerson(legacyPerPerson || (initialValues.length && initialValues.every((value) => value === initialValues[0]) ? initialValues[0] : 0));
    setCategoryBudgets(storedCategoryMap(savedBudget));
    if (!budgetDirty) { setFuelPrice(amountOf(savedBudget.fuelPrice ?? savedBudget.gasPrice) || 175); setFuelEfficiency(decimalOf(savedBudget.fuelEfficiency ?? savedBudget.efficiency) || 18); }
    setSettingsVersion(settingsResult.data?.version ?? null);
    setBudgetReady(true);
    setExpenses((expenseResult.data ?? []).map((expense) => ({ ...expense, payer_id: expense.payer_participant_id, allocation_method: (expense.allocation_method || "equal_selected") as Expense["allocation_method"] })));
    setShares((shareResult.data ?? []).filter((share) => Boolean(share.participant_id)).map((share) => ({ expense_id: share.expense_id, participant_id: share.participant_id, amount: share.amount })));
    setSettlements((settlementResult.data ?? []).filter((settlement) => settlement.from_participant_id && settlement.to_participant_id).map((settlement) => ({ id: settlement.id, from_id: settlement.from_participant_id, to_id: settlement.to_participant_id, amount: settlement.amount, status: settlement.status })));
    setItinerary(itineraryResult.data ?? []);
    setStatus(message);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [tripId]);
  useEffect(() => {
    if (!editingExpenseId) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-expense-editor-id=\"" + editingExpenseId + "\"]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [editingExpenseId]);

  const transportExpensesByItinerary = useMemo(() => {
    const result = new Map<string, number>();
    for (const expense of expenses) {
      if (expense.category !== "transport" || !expense.itinerary_item_id) continue;
      result.set(expense.itinerary_item_id, (result.get(expense.itinerary_item_id) ?? 0) + expenseForecast(expense));
    }
    return result;
  }, [expenses]);
  const fuelForecast = useMemo(() => {
    if (transportExpensesByItinerary.size > 0) return 0;
    const distance = itinerary.filter((item) => item.travel_mode === "car").reduce((sum, item) => sum + decimalOf(item.travel_distance_km), 0);
    return fuelEfficiency > 0 ? Math.round(distance / fuelEfficiency * fuelPrice) : 0;
  }, [fuelEfficiency, fuelPrice, itinerary, transportExpensesByItinerary]);
  const travelForecast = useMemo(() => itinerary.reduce((sum, item) => sum + (transportExpensesByItinerary.has(item.id) ? transportExpensesByItinerary.get(item.id)! : amountOf(item.travel_estimated_cost)), fuelForecast), [fuelForecast, itinerary, transportExpensesByItinerary]);
  const totals = useMemo(() => {
    const replacedTransportIds = new Set(transportExpensesByItinerary.keys());
    const expenseForecastTotal = expenses.reduce((sum, expense) => sum + (expense.category === "transport" && expense.itinerary_item_id && replacedTransportIds.has(expense.itinerary_item_id) ? 0 : expenseForecast(expense)), 0);
    const actual = expenses.filter((expense) => expense.payment_status === "paid").reduce((sum, expense) => sum + amountOf(expense.amount), 0);
    const plannedOnly = expenses.filter((expense) => expense.payment_status !== "paid").reduce((sum, expense) => sum + amountOf(expense.planned_amount), 0);
    return { actual, plannedOnly, travel: travelForecast, forecast: expenseForecastTotal + travelForecast };
  }, [expenses, travelForecast, transportExpensesByItinerary]);
  const budgetTotals = useMemo(() => {
    const selectedPeople = budgetPeople.filter((person) => financeParticipantIds.includes(person.id));
    const total = selectedPeople.reduce((sum, person) => sum + amountOf(participantBudgets[person.id] ?? budgetPerPerson), 0);
    const categoryBudgetTotal = categories.reduce((sum, category) => sum + amountOf(categoryBudgets[category]), 0);
    const hasCategoryBudgets = categoryBudgetTotal > 0;
    const byCategory = categories.map((category) => {
      const expenseTotal = expenses.filter((expense) => expense.category === category && !(category === "transport" && expense.itinerary_item_id && transportExpensesByItinerary.has(expense.itinerary_item_id))).reduce((sum, expense) => sum + expenseForecast(expense), 0);
      const planned = expenseTotal + (category === "transport" ? travelForecast : 0);
      const budget = amountOf(categoryBudgets[category]);
      return { category, planned, budget, remaining: budget > 0 ? budget - planned : null };
    });
    return { total, participantCount: selectedPeople.length, remaining: total - totals.forecast, byCategory, categoryBudgetTotal, hasCategoryBudgets, categoryBudgetGap: total - categoryBudgetTotal };
  }, [budgetPerPerson, budgetPeople, categoryBudgets, expenses, financeParticipantIds, participantBudgets, totals.forecast, transportExpensesByItinerary, travelForecast]);
  const settlementPeople = useMemo(() => {
    const selected = new Set(financeParticipantIds);
    return budgetPeople.filter((person) => selected.has(person.id));
  }, [budgetPeople, financeParticipantIds]);
  const settlementData = useMemo<SettlementData>(() => {
    const selected = new Set(financeParticipantIds);
    const paidBy = new Map<string, number>(settlementPeople.map((person) => [person.id, 0]));
    const burdenBy = new Map<string, number>(settlementPeople.map((person) => [person.id, 0]));
    const eligiblePaidBy = new Map<string, number>(settlementPeople.map((person) => [person.id, 0]));
    const eligibleBurdenBy = new Map<string, number>(settlementPeople.map((person) => [person.id, 0]));
    const adjustmentBy = new Map<string, number>(settlementPeople.map((person) => [person.id, 0]));
    const incompleteExpenses: SettlementData["incompleteExpenses"] = [];
    let unassignedPaid = 0;
    for (const expense of expenses.filter((item) => item.payment_status === "paid")) {
      if (expense.payer_id && selected.has(expense.payer_id)) paidBy.set(expense.payer_id, (paidBy.get(expense.payer_id) ?? 0) + amountOf(expense.amount)); else unassignedPaid += amountOf(expense.amount);
      const expenseShares = shares.filter((share) => share.expense_id === expense.id);
      const shareTotal = expenseShares.reduce((sum, share) => sum + amountOf(share.amount), 0);
      for (const share of expenseShares) if (selected.has(share.participant_id)) burdenBy.set(share.participant_id, (burdenBy.get(share.participant_id) ?? 0) + amountOf(share.amount));
      let reason = "";
      if (!expense.payer_id || !selected.has(expense.payer_id)) reason = "支払者が未設定、または精算対象外";
      else if (!expenseShares.length) reason = "負担者が未設定";
      else if (shareTotal !== amountOf(expense.amount)) reason = "負担額の合計が" + money(shareTotal) + "（実績" + money(expense.amount) + "）";
      else if (expenseShares.some((share) => !selected.has(share.participant_id))) reason = "負担者に精算対象外の参加者が含まれる";
      const payerId = expense.payer_id;
      if (reason || !payerId) { if (reason) incompleteExpenses.push({ id: expense.id, title: expense.title, amount: amountOf(expense.amount), reason }); continue; }
      eligiblePaidBy.set(payerId, (eligiblePaidBy.get(payerId) ?? 0) + amountOf(expense.amount));
      for (const share of expenseShares) eligibleBurdenBy.set(share.participant_id, (eligibleBurdenBy.get(share.participant_id) ?? 0) + amountOf(share.amount));
    }
    for (const settlement of settlements.filter((item) => item.status === "paid" && selected.has(item.from_id) && selected.has(item.to_id))) {
      adjustmentBy.set(settlement.from_id, (adjustmentBy.get(settlement.from_id) ?? 0) + amountOf(settlement.amount));
      adjustmentBy.set(settlement.to_id, (adjustmentBy.get(settlement.to_id) ?? 0) - amountOf(settlement.amount));
    }
    const rows = settlementPeople.map((person) => {
      const paidAmount = paidBy.get(person.id) ?? 0;
      const burdenAmount = burdenBy.get(person.id) ?? 0;
      const before = (eligiblePaidBy.get(person.id) ?? 0) - (eligibleBurdenBy.get(person.id) ?? 0);
      return { id: person.id, paidAmount, burdenAmount, before, remaining: before + (adjustmentBy.get(person.id) ?? 0) };
    });
    const debtors = rows.filter((row) => row.remaining < 0).map((row) => ({ id: row.id, amount: -row.remaining }));
    const creditors = rows.filter((row) => row.remaining > 0).map((row) => ({ id: row.id, amount: row.remaining }));
    const suggestions: SettlementData["suggestions"] = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const amount = Math.min(debtors[debtorIndex].amount, creditors[creditorIndex].amount);
      suggestions.push({ from: debtors[debtorIndex].id, to: creditors[creditorIndex].id, amount });
      debtors[debtorIndex].amount -= amount;
      creditors[creditorIndex].amount -= amount;
      if (debtors[debtorIndex].amount === 0) debtorIndex += 1;
      if (creditors[creditorIndex].amount === 0) creditorIndex += 1;
    }
    return { rows, suggestions, incompleteExpenses, unassignedPaid };
  }, [expenses, financeParticipantIds, settlementPeople, shares, settlements]);

  const saveBudget = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !budgetReady) return;
    setSaving(true);
    const participantIds = budgetPeople.filter((person) => financeParticipantIds.includes(person.id)).map((person) => person.id);
    const nextBudget = { budgetPerPerson: amountOf(budgetPerPerson), budgetParticipantIds: participantIds, participantBudgets, categoryBudgets, settlementParticipantIds: participantIds, fuelPrice: amountOf(fuelPrice), fuelEfficiency: Math.max(1, decimalOf(fuelEfficiency)) };
    const result = settingsVersion === null
      ? await supabase.from("trip_settings").insert({ trip_id: tripId, budget: nextBudget, updated_by: userId }).select("version").maybeSingle<{ version: number }>()
      : await supabase.from("trip_settings").update({ budget: nextBudget, updated_by: userId }).eq("trip_id", tripId).eq("version", settingsVersion).select("version").maybeSingle<{ version: number }>();
    setSaving(false);
    if (result.error || !result.data) { await load(result.error?.code === "23505" ? "他の人が先に予算を保存しました" : "予算を保存できませんでした"); return; }
    setSettingsVersion(result.data.version);
    setBudgetDirty(false);
    setStatus("予算と対象者を保存しました");
  };
  const toggleFinanceParticipant = (id: string) => setFinanceParticipantIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const setParticipantBudget = (id: string, value: string) => {
    setParticipantBudgets((current) => {
      const next = { ...current };
      if (value.trim() === "") delete next[id]; else next[id] = amountOf(value);
      return next;
    });
    setBudgetDirty(true);
  };
  const setCategoryBudget = (category: string, value: string) => { setCategoryBudgets((current) => ({ ...current, [category]: amountOf(value) })); setBudgetDirty(true); };
  const saveExpense = async (payload: ExpenseSavePayload): Promise<ExpenseSaveResult> => {
    if (!supabase || !payload.items.length) return { ok: false, message: "費用を保存できませんでした" };
    const firstItem = payload.items[0];
    setSaving(true);
    const result = payload.id
      ? await supabase.rpc("save_expense_with_shares", { target_trip_id: tripId, target_expense_id: payload.id, expected_version: payload.version, input_title: firstItem.title, input_category: firstItem.category, input_planned_amount: firstItem.planned_amount, input_actual_amount: firstItem.actual_amount, input_payment_status: payload.payment_status, input_payer_id: payload.payer_id, input_itinerary_item_id: payload.itinerary_item_id, input_transaction_id: payload.transaction_id, input_merchant_name: payload.merchant_name, input_purchased_on: payload.purchased_on, input_net_amount: firstItem.net_amount, input_tax_rate: firstItem.tax_rate, input_allocation_method: payload.allocation_method, input_share_user_ids: payload.selected_ids, input_share_amounts: firstItem.share_amounts, input_memo: payload.memo })
      : await supabase.rpc("create_expense_batch_with_shares", { target_trip_id: tripId, input_transaction_id: null, input_merchant_name: payload.merchant_name, input_purchased_on: payload.purchased_on, input_itinerary_item_id: payload.itinerary_item_id, input_payment_status: payload.payment_status, input_payer_id: payload.payer_id, input_allocation_method: payload.allocation_method, input_share_user_ids: payload.selected_ids, input_items: payload.items, input_memo: payload.memo });
    setSaving(false);
    const resultStatus = (result.data as { status?: string } | null)?.status;
    if (result.error || resultStatus !== "ok") {
      const message = resultStatus === "payer_required" ? "支払済みの場合は支払者を選択してください" : "費用を保存できませんでした";
      setStatus(message);
      return { ok: false, message };
    }
    setEditingExpenseId(null);
    await load(payload.id ? "費用を更新しました" : String(payload.items.length) + "件の費用を登録しました");
    return { ok: true };
  };
  const removeExpense = async (expense: Expense) => {
    if (!supabase || !window.confirm("「" + expense.title + "」を削除しますか？")) return;
    setSaving(true);
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id).eq("version", expense.version);
    setSaving(false);
    await load(error ? "費用を削除できませんでした" : "費用を削除しました");
  };
  const markSettlementPaid = async (suggestion: { from: string; to: string; amount: number }) => {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("settlements").insert({ trip_id: tripId, from_participant_id: suggestion.from, to_participant_id: suggestion.to, amount: suggestion.amount, status: "paid", created_by: userId });
    setSaving(false);
    await load(error ? "精算記録を保存できませんでした" : "精算済みとして記録しました");
  };
  const expenseItinerary = (expense: Expense) => expense.itinerary_item_id ? itinerary.find((item) => item.id === expense.itinerary_item_id) : null;
  const unpaidExpenses = expenses.filter((expense) => expense.payment_status !== "paid");
  const paidExpenses = expenses.filter((expense) => expense.payment_status === "paid");
  const renderExpense = (expense: Expense) => {
    const linked = expenseItinerary(expense);
    const expenseShares = shares.filter((share) => share.expense_id === expense.id);
    const expenseBurden = expenseShares.reduce((sum, share) => sum + amountOf(share.amount), 0);
    const paid = expense.payment_status === "paid";
    const isEditing = editingExpenseId === expense.id;
    return <article className={"expense-card" + (isEditing ? " is-editing" : "")} key={expense.id}>
      <div className="finance-expense unified-expense">
        <div className="finance-expense-main"><strong>{expense.title}</strong><span>{categoryLabel[expense.category] ?? expense.category}{expense.merchant_name ? "｜" + expense.merchant_name : ""}{expense.purchased_on ? "｜" + expense.purchased_on.replaceAll("-", "/") : ""}</span><span className="expense-payer">{paid ? "支払者：" + nameOf(expense.payer_id) : "支払者：なし（支払い前）"}{linked ? "｜" + itineraryLabel(linked) : ""}</span>{expense.net_amount > 0 && <small>税抜 {money(expense.net_amount)}＋税 {money(expense.tax_amount)}（{Math.round(Number(expense.tax_rate) * 100)}%）</small>}{expense.memo && <small>{expense.memo}</small>}</div>
        <div className="expense-amount-summary"><span>予定 {money(expense.planned_amount)}</span><b>{paid ? "実績 " + money(expense.amount) : "予定 " + money(expense.planned_amount)}</b><small>負担登録 {money(expenseBurden)}</small></div>
        <small className={paid ? "expense-paid" : "expense-planned"}>{paid ? (expense.payer_id ? "支払済み・精算対象候補" : "支払済み・精算未確定") : "支払い前・予算のみ"}</small>
        <button type="button" className="text-button" aria-expanded={isEditing} onClick={() => setEditingExpenseId(isEditing ? null : expense.id)} disabled={saving}>{isEditing ? "編集を閉じる" : "編集"}</button>
        <button type="button" className="text-button danger" onClick={() => void removeExpense(expense)} disabled={saving}>削除</button>
      </div>
      {isEditing && <div className="expense-inline-editor" data-expense-editor-id={expense.id}><ExpenseEditor initialDraft={createExpenseDraft(expense, expenseShares, settlementPeople)} people={settlementPeople} itinerary={itinerary} saving={saving} onSave={saveExpense} onCancel={() => setEditingExpenseId(null)} /></div>}
    </article>;
  };

  return <main className="budget-shell finance-shell">
    <TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} />
    <p className="save-status" role="status">{status}</p>
    <section className="budget-hero"><p className="kicker">COST & SETTLEMENT</p><h1>費用と精算</h1><p>{tripName}</p></section>
    <section className="summary-grid finance-summary"><Summary label="1人あたり予算" value={budgetTotals.participantCount ? budgetTotals.total / budgetTotals.participantCount : 0} /><Summary label="予定総額" value={totals.forecast} /><Summary label="支払済み・立替" value={totals.actual} tone="paid" /><Summary label={budgetTotals.remaining < 0 ? "予算オーバー" : "予算残額"} value={Math.abs(budgetTotals.remaining)} tone={budgetTotals.remaining < 0 ? "due" : ""} /><Summary label="未払い予定" value={totals.plannedOnly} /><Summary label="精算候補" value={settlementData.suggestions.reduce((sum, item) => sum + item.amount, 0)} tone="due" /></section>
    <p className="finance-summary-note">予算合計は対象者ごとの予算、予定総額は支払済み実績・支払い前予定・行程の移動費を合計します。カテゴリ配分は内訳として別に確認できます。</p>

    <details className="finance-participant-settings">
      <summary>費用・予算・精算の対象者（{financeParticipantIds.length}/{budgetPeople.length}人）</summary>
      <form className="settlement-scope-form" onSubmit={saveBudget}>
        <p>ここで選んだ参加者を、費用の負担対象・予算対象・精算対象に共通で使います。旅行後半だけ参加する人は外してください。</p>
        <div className="finance-participant-list">{budgetPeople.map((person) => <div className="budget-participant-row" key={person.id}>
          <label className="budget-participant-check"><input type="checkbox" checked={financeParticipantIds.includes(person.id)} onChange={() => toggleFinanceParticipant(person.id)} disabled={saving || (financeParticipantIds.length === 1 && financeParticipantIds.includes(person.id))} /><span><strong>{person.name}</strong><small>{person.profile_id ? "ログイン済み" : "仮登録"}・費用と精算の対象</small></span></label>
          <label className="budget-participant-amount"><span>個別予算</span><input type="number" min="0" step="100" value={participantBudgets[person.id] ?? ""} placeholder={budgetPerPerson ? money(budgetPerPerson) : "0"} onChange={(event) => setParticipantBudget(person.id, event.target.value)} disabled={!financeParticipantIds.includes(person.id) || saving} /></label>
        </div>)}{!budgetPeople.length && <p className="empty-state">参加者を登録すると対象者を選べます。</p>}</div>
        <p className="finance-note">個別予算を空欄にすると、基本の1人あたり予算（{money(budgetPerPerson)}）を使います。0円を入力した場合は0円として計算します。</p>
        <button className="save-button" disabled={!budgetReady || saving}>{saving ? "保存中…" : "対象者と個別予算を保存"}</button>
      </form>
    </details>

    <h2 className="budget-title">予算設定</h2>
    <details className="budget-settings-drawer">
      <summary><span>予算の詳細設定</span><small>基本額・カテゴリ別・燃料設定</small></summary>
      <section className="panel budget-planner">
        <div className="budget-planner-heading"><div><h3>基本の予算とカテゴリ別配分</h3><p>参加者ごとの予算合計を総予算として、支払い前の予定と支払済みの実績を差し引きます。カテゴリ配分の合計は内訳の確認に使います。</p></div><form className="budget-planner-form unified-budget-form" onSubmit={saveBudget}><label><span>基本の1人あたり予算</span><input type="number" min="0" step="100" value={displayNumber(budgetPerPerson)} placeholder="0" onChange={(event) => { setBudgetPerPerson(amountOf(event.target.value)); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><label><span>ガソリン単価（円/L）</span><input type="number" min="0" step="1" value={displayNumber(fuelPrice)} placeholder="0" onChange={(event) => { setFuelPrice(amountOf(event.target.value)); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><label><span>実燃費（km/L）</span><input type="number" min="1" step="0.1" value={displayNumber(fuelEfficiency)} placeholder="18" onChange={(event) => { setFuelEfficiency(event.target.value === "" ? 0 : Math.max(1, decimalOf(event.target.value))); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><button className="save-button" disabled={!budgetReady || saving}>{saving ? "保存中…" : "予算設定を保存"}</button></form></div>
        <div className="category-budget-grid">{categories.map((category) => <label key={category}><span>{categoryLabel[category]}の配分予算</span><input type="number" min="0" step="100" value={categoryBudgets[category] || ""} placeholder="0" onChange={(event) => setCategoryBudget(category, event.target.value)} disabled={!budgetReady || saving} /><small>見込み {money(budgetTotals.byCategory.find((item) => item.category === category)?.planned ?? 0)}</small></label>)}</div>
        {budgetTotals.hasCategoryBudgets && budgetTotals.categoryBudgetGap !== 0 && <div className="budget-calculation-warning"><strong>参加者予算とカテゴリ配分の合計が一致していません。</strong><span>参加者予算 {money(budgetTotals.total)} ／ カテゴリ配分 {money(budgetTotals.categoryBudgetTotal)} ／ 差額 {money(Math.abs(budgetTotals.categoryBudgetGap))}{budgetTotals.categoryBudgetGap > 0 ? "（カテゴリ配分が少ない）" : "（カテゴリ配分が多い）"}。</span></div>}
        <div className="budget-planner-metrics"><BudgetMetric label="参加者予算" value={money(budgetTotals.total)} /><BudgetMetric label="カテゴリ配分" value={budgetTotals.hasCategoryBudgets ? money(budgetTotals.categoryBudgetTotal) : "未設定"} /><BudgetMetric label="予定総額" value={money(totals.forecast)} /><BudgetMetric label={budgetTotals.remaining < 0 ? "予算オーバー" : "残り予算"} value={money(Math.abs(budgetTotals.remaining))} tone={budgetTotals.remaining < 0 ? "over" : "remaining"} /></div>
        <div className="category-budget-summary">{budgetTotals.byCategory.map((item) => <div key={item.category}><span>{categoryLabel[item.category]}</span><b>見込み {money(item.planned)}</b>{item.budget > 0 && <small>配分 {money(item.budget)} ／ {item.remaining !== null && item.remaining < 0 ? "超過 " + money(-item.remaining) : "残り " + money(item.remaining ?? 0)}</small>}</div>)}</div>
      </section>
    </details>

    <h2 className="budget-title">登録済みの費用</h2>
    <section className="panel finance-panel">
      <div className="expense-entry-header"><div><h3>支払い前・支払済み</h3><p>登録済みの費用はここで確認できます。編集を押すと、この一覧の中で明細・税率・支払者・負担者を開いて変更できます。</p></div><Link className="add-button expense-add-button" href={"/trips/" + tripSlug + "/budget/expenses/new"}>＋ 支出を追加</Link></div>
      <div className="expense-status-columns">
        <section className="expense-status-section"><div className="finance-subheading"><h3>支払い前・予定</h3><small>支払者なし／予算に反映</small></div><div className="finance-list">{unpaidExpenses.map(renderExpense)}</div>{!unpaidExpenses.length && <p className="empty-state">支払い前の予定はありません。</p>}</section>
        <section className="expense-status-section"><div className="finance-subheading"><h3>支払済み</h3><small>支払者必須／精算候補</small></div><div className="finance-list">{paidExpenses.map(renderExpense)}</div>{!paidExpenses.length && <p className="empty-state">支払済みの費用はありません。</p>}</section>
      </div>
    </section>

    <h2 className="budget-title">行程に紐づく移動費</h2>
    <section className="panel finance-panel"><p className="finance-note">高速代・駐車場代などは費用の「予定額」と「実績額」を分けて管理し、関連する行程へ紐づけられます。移動費を個別登録した区間は、その費用を行程の想定額として集計します。</p><div className="travel-cost-list">{itinerary.filter((item) => item.travel_estimated_cost > 0 || transportExpensesByItinerary.has(item.id)).map((item) => <div className="travel-cost-row" key={item.id}><div><strong>{itineraryLabel(item)}</strong><span>{item.travel_mode === "car" ? "車" : item.travel_mode || "移動"}</span></div><b>{money(transportExpensesByItinerary.get(item.id) ?? item.travel_estimated_cost)}</b><small>{transportExpensesByItinerary.has(item.id) ? "費用一覧から集計" : "行程の予定額"}</small></div>)}</div><div className="travel-total-row"><span>ガソリン見込（車の距離 ÷ 実燃費 × 単価）</span><b>{money(fuelForecast)}</b></div>{!itinerary.some((item) => item.travel_estimated_cost > 0 || transportExpensesByItinerary.has(item.id)) && !fuelForecast && <p className="empty-state">移動費の予定はまだありません。</p>}</section>

    <h2 className="budget-title">精算</h2>
    <section className="panel finance-panel"><p className="finance-note">「支払った額 − 負担額 ＝ 精算前差額」です。支払い前の予定は精算に入りません。下の支払額・負担額は登録済みの支払済み費用、差額と送金候補は精算条件を満たした費用から計算しています。</p>
      <div className="settlement-breakdown"><div className="finance-subheading"><div><h3>参加者別の支払い・負担内訳</h3><small className="finance-note-inline">費用・予算・精算の対象者のみ表示</small></div></div><div className="settlement-table-wrap"><table className="settlement-table"><thead><tr><th scope="col">参加者</th><th scope="col">支払った額</th><th scope="col">負担額</th><th scope="col">精算前差額</th><th scope="col">精算後残額</th></tr></thead><tbody>{settlementData.rows.map((row) => <tr key={row.id}><th scope="row">{nameOf(row.id)}</th><td>{money(row.paidAmount)}</td><td>{money(row.burdenAmount)}</td><td className={row.before > 0 ? "settlement-positive" : row.before < 0 ? "settlement-negative" : ""}>{row.before > 0 ? "受取 " + money(row.before) : row.before < 0 ? "支払 " + money(-row.before) : "± ￥0"}</td><td className={row.remaining > 0 ? "settlement-positive" : row.remaining < 0 ? "settlement-negative" : ""}>{row.remaining > 0 ? "受取 " + money(row.remaining) : row.remaining < 0 ? "支払 " + money(-row.remaining) : "± ￥0"}</td></tr>)}</tbody></table></div></div>
      {settlementData.unassignedPaid > 0 && <div className="settlement-warning"><strong>精算対象外の支払済みが {money(settlementData.unassignedPaid)} あります。</strong><span>支払者が未設定、または費用・精算の対象者から外れているため、候補に反映していません。</span></div>}
      {settlementData.incompleteExpenses.length > 0 && <div className="settlement-warning"><strong>精算に反映していない費用があります。</strong>{settlementData.incompleteExpenses.map((expense) => <span key={expense.id}>「{expense.title}」{money(expense.amount)}：{expense.reason}。編集して支払者・負担者・負担額を揃えてください。</span>)}</div>}
      <div className="finance-subheading"><div><h3>送金候補</h3><small className="finance-note-inline">候補を確認して、実際に送金したら記録します</small></div></div><div className="settlement-list">{settlementData.suggestions.map((suggestion) => <div className="settlement-row" key={suggestion.from + "-" + suggestion.to + "-" + suggestion.amount}><span>{nameOf(suggestion.from)} → {nameOf(suggestion.to)}</span><b>{money(suggestion.amount)}</b><button className="save-button" onClick={() => void markSettlementPaid(suggestion)} disabled={saving}>支払済みにする</button></div>)}</div>{!settlementData.suggestions.length && <p className="empty-state">現在、精算候補はありません。</p>}
      <div className="settlement-history">{settlements.filter((item) => item.status === "paid" && financeParticipantIds.includes(item.from_id) && financeParticipantIds.includes(item.to_id)).map((settlement) => <span key={settlement.id}>{nameOf(settlement.from_id)} → {nameOf(settlement.to_id)} {money(settlement.amount)} 済</span>)}</div>
    </section>
    <TripTabs tripSlug={tripSlug} active="budget" />
  </main>;
}

function Summary({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={"summary-card " + tone}><span>{label}</span><strong>{money(value)}</strong></div>; }
function BudgetMetric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <div className={"budget-planner-metric " + tone}><span>{label}</span><strong>{value}</strong></div>; }
