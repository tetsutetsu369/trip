"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Person = { id: string; name: string };
type BudgetPerson = { id: string; name: string; profile_id: string | null };
type ReceiptItem = { id: string; receipt_id: string; name: string; category: string; net_amount: number; tax_rate: number; tax_amount: number; gross_amount: number };
type Receipt = { id: string; store_name: string; purchased_on: string | null; payer_id: string | null; memo: string; version: number; items: ReceiptItem[] };
type Expense = {
  id: string;
  receipt_id: string | null;
  purchase_id: string | null;
  itinerary_item_id: string | null;
  title: string;
  category: string;
  planned_amount: number;
  amount: number;
  payer_id: string | null;
  payment_status: "unpaid" | "paid" | string;
  settlement_status: string;
  allocation_method: AllocationMethod;
  memo: string;
  version: number;
};
type Share = { expense_id: string; user_id: string; amount: number };
type Settlement = { id: string; from_user_id: string; to_user_id: string; amount: number; status: string };
type Itinerary = {
  id: string;
  event_date: string | null;
  event_time: string | null;
  title: string;
  place: string;
  travel_origin: string;
  travel_destination: string;
  travel_distance_km: number;
  travel_estimated_cost: number;
  travel_mode: string;
};
type DraftItem = { name: string; category: string; net_amount: number; tax_rate: number };
type AllocationMethod = "equal_all" | "equal_selected" | "custom" | "personal";
type ExpenseDraft = {
  id: string | null;
  version: number | null;
  receipt_id: string | null;
  purchase_id: string | null;
  title: string;
  category: string;
  planned_amount: number;
  actual_amount: number;
  payment_status: "unpaid" | "paid";
  payer_id: string;
  itinerary_item_id: string;
  allocation_method: AllocationMethod;
  share_user_ids: string[];
  share_amounts: Record<string, number>;
  memo: string;
};

const categories = ["food", "equipment", "supplies", "lodging", "activity", "transport", "other"] as const;
const categoryLabel: Record<string, string> = { food: "食費", equipment: "備品", supplies: "消耗品", lodging: "宿泊", activity: "遊び", transport: "移動", receipt: "レシート", other: "その他" };
const allocationLabel: Record<AllocationMethod, string> = { equal_all: "対象者全員で均等", equal_selected: "選択した人で均等", custom: "負担額を指定", personal: "個人負担" };
const money = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const amountOf = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};
const decimalOf = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};
const displayNumber = (value: number) => value === 0 ? "" : value;
const budgetSettingsOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const storedMap = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, amountOf(amount)])) : {} as Record<string, number>;
const storedCategoryMap = (settings: Record<string, unknown>) => storedMap(settings.categoryBudgets);
const expenseForecast = (expense: Expense) => expense.payment_status === "paid" ? amountOf(expense.amount) : amountOf(expense.planned_amount);
const splitEvenly = (total: number, ids: string[]) => {
  const safeIds = [...new Set(ids)];
  if (!safeIds.length) return {} as Record<string, number>;
  const base = Math.floor(Math.max(0, total) / safeIds.length);
  const remainder = Math.max(0, total) % safeIds.length;
  return Object.fromEntries(safeIds.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
};

export default function FinancePage({ tripId, tripSlug, tripName, avatarUrl = null, userId }: { tripId: string; tripSlug: string; tripName: string; avatarUrl?: string | null; userId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [people, setPeople] = useState<Person[]>([]);
  const [budgetPeople, setBudgetPeople] = useState<BudgetPerson[]>([]);
  const [budgetParticipantIds, setBudgetParticipantIds] = useState<string[]>([]);
  const [settlementParticipantIds, setSettlementParticipantIds] = useState<string[]>([]);
  const [participantBudgets, setParticipantBudgets] = useState<Record<string, number>>({});
  const [budgetPerPerson, setBudgetPerPerson] = useState(0);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [budgetSettings, setBudgetSettings] = useState<Record<string, unknown>>({});
  const [fuelPrice, setFuelPrice] = useState(175);
  const [fuelEfficiency, setFuelEfficiency] = useState(18);
  const [settingsVersion, setSettingsVersion] = useState<number | null>(null);
  const [budgetReady, setBudgetReady] = useState(false);
  const [budgetDirty, setBudgetDirty] = useState(false);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [receiptDraft, setReceiptDraft] = useState({ store_name: "", purchased_on: today(), payer_id: userId, category: "receipt", itinerary_item_id: "", memo: "" });
  const [receiptShareIds, setReceiptShareIds] = useState<string[]>([]);
  const [items, setItems] = useState<DraftItem[]>([{ name: "", category: "food", net_amount: 0, tax_rate: 0.1 }]);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? "未設定";
  const itineraryLabel = (item: Itinerary) => {
    const route = [item.travel_origin, item.travel_destination].filter(Boolean).join(" → ");
    return route || [item.event_date?.replaceAll("-", "/"), item.event_time?.slice(0, 5), item.title, item.place].filter(Boolean).join("｜");
  };
  const load = async (message = "みんなに共有済み") => {
    if (!supabase) { setStatus("Supabase未接続"); return; }
    const [settingsResult, receiptResult, itemResult, expenseResult, shareResult, settlementResult, memberResult, profileMemberResult, itineraryResult] = await Promise.all([
      supabase.from("trip_settings").select("budget,version").eq("trip_id", tripId).maybeSingle<{ budget: Record<string, unknown> | null; version: number }>(),
      supabase.from("receipts").select("id,store_name,purchased_on,payer_id,memo,version").eq("trip_id", tripId).order("purchased_on", { ascending: false }),
      supabase.from("receipt_items").select("id,receipt_id,name,category,net_amount,tax_rate,tax_amount,gross_amount"),
      supabase.from("expenses").select("id,receipt_id,purchase_id,itinerary_item_id,title,category,planned_amount,amount,payer_id,payment_status,settlement_status,allocation_method,memo,version").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("expense_shares").select("expense_id,user_id,amount"),
      supabase.from("settlements").select("id,from_user_id,to_user_id,amount,status").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("trip_members").select("user_id").eq("trip_id", tripId).eq("status", "approved"),
      supabase.from("trip_participants").select("id,display_name,profile_id").eq("trip_id", tripId).order("created_at"),
      supabase.from("itinerary_items").select("id,event_date,event_time,title,place,travel_origin,travel_destination,travel_distance_km,travel_estimated_cost,travel_mode").eq("trip_id", tripId).order("event_date").order("event_time"),
    ]);
    if (settingsResult.error || receiptResult.error || itemResult.error || expenseResult.error || shareResult.error || settlementResult.error || memberResult.error || profileMemberResult.error || itineraryResult.error) { setStatus("費用データを読み込めませんでした"); return; }

    const savedBudget = budgetSettingsOf(settingsResult.data?.budget);
    const userIds = (memberResult.data ?? []).map((member) => member.user_id);
    const savedSettlementParticipantIds = Array.isArray(savedBudget.settlementParticipantIds)
      ? savedBudget.settlementParticipantIds.filter((id): id is string => typeof id === "string" && userIds.includes(id))
      : userIds;
    const savedBudgetPeople: BudgetPerson[] = (profileMemberResult.data ?? []).map((person) => ({ id: person.id, name: person.display_name, profile_id: person.profile_id }));
    const savedParticipantIds = Array.isArray(savedBudget.budgetParticipantIds)
      ? savedBudget.budgetParticipantIds.filter((id): id is string => typeof id === "string" && savedBudgetPeople.some((person) => person.id === id))
      : savedBudgetPeople.map((person) => person.id);
    const savedParticipantBudgets = storedMap(savedBudget.participantBudgets);
    const legacyPerPerson = amountOf(savedBudget.budgetPerPerson ?? savedBudget.purchasePerBudget ?? savedBudget.purchasePerPerson);
    const initialBudgets = Object.keys(savedParticipantBudgets).length ? savedParticipantBudgets : legacyPerPerson ? Object.fromEntries(savedBudgetPeople.map((person) => [person.id, legacyPerPerson])) : {};
    const savedCategoryBudgets = storedCategoryMap(savedBudget);
    const savedFuelPrice = amountOf(savedBudget.fuelPrice ?? savedBudget.gasPrice) || 175;
    const savedFuelEfficiency = decimalOf(savedBudget.fuelEfficiency ?? savedBudget.efficiency) || 18;
    setBudgetSettings(savedBudget);
    setBudgetPeople(savedBudgetPeople);
    setBudgetParticipantIds(savedParticipantIds);
    setSettlementParticipantIds(savedSettlementParticipantIds);
    setParticipantBudgets(initialBudgets);
    const initialValues = Object.values(initialBudgets);
    setBudgetPerPerson(legacyPerPerson || (initialValues.length && initialValues.every((value) => value === initialValues[0]) ? initialValues[0] : 0));
    setCategoryBudgets(savedCategoryBudgets);
    if (!budgetDirty) { setFuelPrice(savedFuelPrice); setFuelEfficiency(savedFuelEfficiency); }
    setSettingsVersion(settingsResult.data?.version ?? null);
    setBudgetReady(true);

    const profileResult = userIds.length ? await supabase.from("profiles").select("id,nickname,line_display_name").in("id", userIds) : { data: [], error: null };
    if (profileResult.error) { setStatus("参加者を読み込めませんでした"); return; }
    const itemMap = new Map<string, ReceiptItem[]>();
    for (const item of itemResult.data ?? []) itemMap.set(item.receipt_id, [...(itemMap.get(item.receipt_id) ?? []), item]);
    setPeople((profileResult.data ?? []).map((profile) => ({ id: profile.id, name: profile.nickname || profile.line_display_name || "参加者" })));
    setReceipts((receiptResult.data ?? []).map((receipt) => ({ ...receipt, items: itemMap.get(receipt.id) ?? [] })));
    setExpenses((expenseResult.data ?? []).map((expense) => ({ ...expense, allocation_method: (expense.allocation_method || "equal_all") as AllocationMethod })));
    setShares(shareResult.data ?? []);
    setSettlements(settlementResult.data ?? []);
    setItinerary(itineraryResult.data ?? []);
    if (!receiptShareIds.length && savedSettlementParticipantIds.length) setReceiptShareIds(savedSettlementParticipantIds);
    setStatus(message);
  };
  useEffect(() => { void load(); }, [tripId]);
  useEffect(() => {
    if (!expenseDraft?.id) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLFormElement>(".expense-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [expenseDraft?.id]);

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
    const selectedPeople = budgetPeople.filter((person) => budgetParticipantIds.includes(person.id));
    const total = selectedPeople.reduce((sum, person) => sum + amountOf(participantBudgets[person.id] ?? budgetPerPerson), 0);
    const byCategory = categories.map((category) => {
      const expenseTotal = expenses.filter((expense) => expense.category === category && !(category === "transport" && expense.itinerary_item_id && transportExpensesByItinerary.has(expense.itinerary_item_id))).reduce((sum, expense) => sum + expenseForecast(expense), 0);
      return { category, planned: expenseTotal + (category === "transport" ? travelForecast : 0), budget: amountOf(categoryBudgets[category]) };
    });
    return { total, participantCount: selectedPeople.length, remaining: total - (totals.forecast), byCategory };
  }, [budgetParticipantIds, budgetPeople, budgetPerPerson, categoryBudgets, expenses, participantBudgets, totals.forecast, transportExpensesByItinerary, travelForecast]);
  const settlementPeople = useMemo(() => {
    const selected = new Set(settlementParticipantIds);
    return people.filter((person) => selected.has(person.id));
  }, [people, settlementParticipantIds]);
  const balances = useMemo(() => {
    const selected = new Set(settlementParticipantIds);
    const result = new Map<string, number>(settlementPeople.map((person) => [person.id, 0]));
    for (const expense of expenses) {
      if (expense.payment_status !== "paid" || !expense.payer_id || !selected.has(expense.payer_id)) continue;
      result.set(expense.payer_id, (result.get(expense.payer_id) ?? 0) + amountOf(expense.amount));
      for (const share of shares.filter((item) => item.expense_id === expense.id && selected.has(item.user_id))) result.set(share.user_id, (result.get(share.user_id) ?? 0) - amountOf(share.amount));
    }
    for (const settlement of settlements.filter((item) => item.status === "paid")) {
      if (!selected.has(settlement.from_user_id) || !selected.has(settlement.to_user_id)) continue;
      result.set(settlement.from_user_id, (result.get(settlement.from_user_id) ?? 0) + settlement.amount);
      result.set(settlement.to_user_id, (result.get(settlement.to_user_id) ?? 0) - settlement.amount);
    }
    return [...result.entries()].map(([id, amount]) => ({ id, amount })).filter((item) => Math.abs(item.amount) > 0);
  }, [expenses, settlementParticipantIds, settlementPeople, shares, settlements]);
  const suggestions = useMemo(() => {
    const debtors = balances.filter((item) => item.amount < 0).map((item) => ({ ...item, amount: -item.amount }));
    const creditors = balances.filter((item) => item.amount > 0).map((item) => ({ ...item }));
    const result: { from: string; to: string; amount: number }[] = [];
    let debtorIndex = 0; let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const amount = Math.min(debtors[debtorIndex].amount, creditors[creditorIndex].amount);
      result.push({ from: debtors[debtorIndex].id, to: creditors[creditorIndex].id, amount });
      debtors[debtorIndex].amount -= amount; creditors[creditorIndex].amount -= amount;
      if (debtors[debtorIndex].amount === 0) debtorIndex += 1;
      if (creditors[creditorIndex].amount === 0) creditorIndex += 1;
    }
    return result;
  }, [balances]);

  const saveBudget = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !budgetReady) return;
    setSaving(true);
    const nextBudget = { ...budgetSettings, budgetPerPerson: amountOf(budgetPerPerson), budgetParticipantIds, participantBudgets, categoryBudgets, settlementParticipantIds, fuelPrice: amountOf(fuelPrice), fuelEfficiency: Math.max(1, decimalOf(fuelEfficiency)) };
    const result = settingsVersion === null
      ? await supabase.from("trip_settings").insert({ trip_id: tripId, budget: nextBudget, updated_by: userId }).select("version").maybeSingle<{ version: number }>()
      : await supabase.from("trip_settings").update({ budget: nextBudget, updated_by: userId }).eq("trip_id", tripId).eq("version", settingsVersion).select("version").maybeSingle<{ version: number }>();
    setSaving(false);
    if (result.error || !result.data) { await load(result.error?.code === "23505" ? "他の人が先に予算を保存しました" : "予算を保存できませんでした"); return; }
    setBudgetSettings(nextBudget); setSettingsVersion(result.data.version); setBudgetDirty(false); setStatus("予算を保存しました");
  };
  const toggleBudgetParticipant = (id: string) => { setBudgetParticipantIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); setBudgetDirty(true); };
  const toggleSettlementParticipant = (id: string) => { setSettlementParticipantIds((current) => current.includes(id) ? (current.length > 1 ? current.filter((value) => value !== id) : current) : [...current, id]); setBudgetDirty(true); };
  const setParticipantBudget = (id: string, value: string) => { setParticipantBudgets((current) => { const next = { ...current }; if (value === "") delete next[id]; else next[id] = amountOf(value); return next; }); setBudgetDirty(true); };
  const setCategoryBudget = (category: string, value: string) => { setCategoryBudgets((current) => { const next = { ...current }; if (value.trim() === "") delete next[category]; else next[category] = amountOf(value); return next; }); setBudgetDirty(true); };

  const newExpenseDraft = (): ExpenseDraft => ({ id: null, version: null, receipt_id: null, purchase_id: null, title: "", category: "food", planned_amount: 0, actual_amount: 0, payment_status: "unpaid", payer_id: settlementParticipantIds.includes(userId) ? userId : "", itinerary_item_id: "", allocation_method: "equal_all", share_user_ids: settlementPeople.map((person) => person.id), share_amounts: splitEvenly(0, settlementPeople.map((person) => person.id)), memo: "" });
  const beginEditExpense = (expense: Expense) => {
    const expenseShares = shares.filter((share) => share.expense_id === expense.id);
    setExpenseDraft({ id: expense.id, version: expense.version, receipt_id: expense.receipt_id, purchase_id: expense.purchase_id, title: expense.title, category: expense.category, planned_amount: expense.planned_amount, actual_amount: expense.amount, payment_status: expense.payment_status === "paid" ? "paid" : "unpaid", payer_id: expense.payer_id ?? "", itinerary_item_id: expense.itinerary_item_id ?? "", allocation_method: expense.allocation_method, share_user_ids: expenseShares.map((share) => share.user_id), share_amounts: Object.fromEntries(expenseShares.map((share) => [share.user_id, share.amount])), memo: expense.memo });
  };
  const saveExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !expenseDraft || !expenseDraft.title.trim()) return;
    const baseTotal = expenseDraft.payment_status === "paid" ? amountOf(expenseDraft.actual_amount) : amountOf(expenseDraft.planned_amount);
    const selected = new Set(settlementParticipantIds);
    const shareUserIds = expenseDraft.allocation_method === "equal_all" ? settlementPeople.map((person) => person.id) : expenseDraft.allocation_method === "personal" ? (expenseDraft.payer_id && selected.has(expenseDraft.payer_id) ? [expenseDraft.payer_id] : []) : expenseDraft.share_user_ids.filter((id) => selected.has(id));
    const payerId = expenseDraft.payer_id && selected.has(expenseDraft.payer_id) ? expenseDraft.payer_id : null;
    const shareAmounts = expenseDraft.allocation_method === "custom" ? Object.fromEntries(Object.entries(expenseDraft.share_amounts).filter(([, amount]) => amountOf(amount) > 0).map(([id, amount]) => [id, amountOf(amount)])) : {};
    if (!shareUserIds.length || (expenseDraft.allocation_method === "custom" && Object.values(shareAmounts).reduce((sum, amount) => sum + amount, 0) !== baseTotal)) { setStatus("負担額の合計を確認してください"); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("save_expense_with_shares", { target_trip_id: tripId, target_expense_id: expenseDraft.id, expected_version: expenseDraft.version, input_title: expenseDraft.title.trim(), input_category: expenseDraft.category, input_planned_amount: amountOf(expenseDraft.planned_amount), input_actual_amount: amountOf(expenseDraft.actual_amount), input_payment_status: expenseDraft.payment_status, input_payer_id: payerId, input_itinerary_item_id: expenseDraft.itinerary_item_id || null, input_purchase_id: expenseDraft.purchase_id, input_receipt_id: expenseDraft.receipt_id, input_allocation_method: expenseDraft.allocation_method === "equal_all" ? "equal_selected" : expenseDraft.allocation_method, input_share_user_ids: shareUserIds, input_share_amounts: shareAmounts, input_memo: expenseDraft.memo.trim() });
    setSaving(false);
    if (error || data?.status !== "ok") { await load(data?.status === "conflict" ? "他の人が先に更新しました" : "費用を保存できませんでした"); return; }
    setExpenseDraft(null); await load(expenseDraft.id ? "費用を更新しました" : "費用を追加しました");
  };
  const removeExpense = async (expense: Expense) => {
    if (!supabase || !window.confirm(`「${expense.title}」を削除しますか？`)) return;
    setSaving(true);
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id).eq("version", expense.version);
    setSaving(false); await load(error ? "費用を削除できませんでした" : "費用を削除しました");
  };
  const removeReceipt = async (receipt: Receipt) => {
    if (!supabase || !window.confirm(`「${receipt.store_name}」のレシートと紐づく費用を削除しますか？`)) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("delete_receipt_expense", { target_receipt_id: receipt.id, expected_version: receipt.version });
    setSaving(false);
    await load(error || data?.status !== "ok" ? "レシートを削除できませんでした" : "レシートと費用を削除しました");
  };
  const submitReceipt = async (event: FormEvent) => {
    event.preventDefault();
    const selected = new Set(settlementParticipantIds);
    const shareIds = receiptShareIds.filter((id) => selected.has(id));
    const payerId = receiptDraft.payer_id && selected.has(receiptDraft.payer_id) ? receiptDraft.payer_id : null;
    if (!supabase || !receiptDraft.store_name.trim() || !items.some((item) => item.name.trim() && item.net_amount > 0) || !shareIds.length) { setStatus("店名・明細・負担者を入力してください"); return; }
    setSaving(true);
    const inputItems = items.filter((item) => item.name.trim() && item.net_amount > 0).map((item) => { const taxAmount = Math.floor(item.net_amount * item.tax_rate); return { name: item.name.trim(), category: item.category, net_amount: item.net_amount, tax_rate: item.tax_rate, tax_amount: taxAmount, gross_amount: item.net_amount + taxAmount }; });
    const { data, error } = await supabase.rpc("create_receipt_expense_with_shares", { target_trip_id: tripId, input_store_name: receiptDraft.store_name.trim(), input_purchased_on: receiptDraft.purchased_on || null, input_payer_id: payerId, input_category: receiptDraft.category, input_memo: receiptDraft.memo.trim(), input_items: inputItems, input_itinerary_item_id: receiptDraft.itinerary_item_id || null, input_allocation_method: "equal_selected", input_share_user_ids: shareIds, input_share_amounts: {} });
    setSaving(false);
    if (error || data?.status !== "ok") { setStatus("レシートを保存できませんでした"); return; }
    setReceiptDraft({ store_name: "", purchased_on: today(), payer_id: settlementParticipantIds.includes(userId) ? userId : "", category: "receipt", itinerary_item_id: "", memo: "" }); setItems([{ name: "", category: "food", net_amount: 0, tax_rate: 0.1 }]); await load("レシートと費用を保存しました");
  };
  const markSettlementPaid = async (suggestion: { from: string; to: string; amount: number }) => {
    if (!supabase) return; setSaving(true);
    const { error } = await supabase.from("settlements").insert({ trip_id: tripId, from_user_id: suggestion.from, to_user_id: suggestion.to, amount: suggestion.amount, status: "paid", created_by: userId });
    setSaving(false); await load(error ? "精算記録を保存できませんでした" : "精算済みとして記録しました");
  };
  const toggleExpenseShare = (id: string) => setExpenseDraft((current) => current ? { ...current, share_user_ids: current.share_user_ids.includes(id) ? current.share_user_ids.filter((value) => value !== id) : [...current.share_user_ids, id] } : current);
  const toggleReceiptShare = (id: string) => setReceiptShareIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const updateExpenseShareAmount = (id: string, value: string) => setExpenseDraft((current) => current ? { ...current, share_amounts: { ...current.share_amounts, [id]: amountOf(value) } } : current);
  const updateReceiptItem = (index: number, patch: Partial<DraftItem>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const expenseItinerary = (expense: Expense) => expense.itinerary_item_id ? itinerary.find((item) => item.id === expense.itinerary_item_id) : null;

  return <main className="budget-shell finance-shell"><TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} /><p className="save-status" role="status">{status}</p>
    <section className="budget-hero"><p className="kicker">COST & SETTLEMENT</p><h1>費用と精算</h1><p>{tripName}</p></section>
    <section className="summary-grid finance-summary"><Summary label="1人あたり予算" value={budgetTotals.participantCount ? budgetTotals.total / budgetTotals.participantCount : 0} /><Summary label="予定総額" value={totals.forecast} /><Summary label="支払済み・立替" value={totals.actual} tone="paid" /><Summary label={budgetTotals.remaining < 0 ? "予算オーバー" : "予算残額"} value={Math.abs(budgetTotals.remaining)} tone={budgetTotals.remaining < 0 ? "due" : ""} /><Summary label="未払い予定" value={totals.plannedOnly} /><Summary label="精算候補" value={suggestions.reduce((sum, item) => sum + item.amount, 0)} tone="due" /></section>

    <details className="settlement-scope-settings"><summary>費用・精算の対象者（{settlementParticipantIds.length}/{people.length}人）</summary><form className="settlement-scope-form" onSubmit={saveBudget}><p>旅行の後半だけ参加する人など、費用と精算から外したい人のチェックを外してください。</p><div className="settlement-scope-list">{people.map((person) => <label key={person.id}><input type="checkbox" checked={settlementParticipantIds.includes(person.id)} onChange={() => toggleSettlementParticipant(person.id)} disabled={saving || settlementParticipantIds.length === 1 && settlementParticipantIds.includes(person.id)} /><span>{person.name}</span></label>)}</div><button className="save-button" disabled={!budgetReady || saving}>{saving ? "保存中…" : "対象者設定を保存"}</button></form></details>
    <h2 className="budget-title">予算設定</h2>
    <details className="budget-settings-drawer"><summary><span>予算の詳細設定</span><small>1人あたり・カテゴリ別・燃料設定</small></summary>
    <section className="panel budget-planner"><div className="budget-planner-heading"><div><h3>1人あたりの予算と項目別配分</h3><p>参加者ごとの予算を合計し、登録した費用の予定額・実績額を同じ予算から差し引きます。</p></div><form className="budget-planner-form unified-budget-form" onSubmit={saveBudget}><label><span>基本の1人あたり予算</span><input type="number" min="0" step="100" value={displayNumber(budgetPerPerson)} placeholder="0" onChange={(event) => { setBudgetPerPerson(amountOf(event.target.value)); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><label><span>ガソリン単価（円/L）</span><input type="number" min="0" step="1" value={displayNumber(fuelPrice)} placeholder="0" onChange={(event) => { setFuelPrice(amountOf(event.target.value)); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><label><span>実燃費（km/L）</span><input type="number" min="1" step="0.1" value={displayNumber(fuelEfficiency)} placeholder="18" onChange={(event) => { setFuelEfficiency(event.target.value === "" ? 0 : Math.max(1, decimalOf(event.target.value))); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><button className="save-button" disabled={!budgetReady || saving}>{saving ? "保存中…" : "予算を保存"}</button></form></div>
      <details className="budget-participant-settings"><summary>予算に含める参加者と個別調整（{budgetParticipantIds.length}/{budgetPeople.length}人）</summary><div className="budget-participant-list"><div className="budget-participant-heading"><strong>予算対象の参加者</strong><span>個別予算を空欄にすると基本予算を使用</span></div>{budgetPeople.map((person) => <div className="budget-participant-row" key={person.id}><label className="budget-participant-check"><input type="checkbox" checked={budgetParticipantIds.includes(person.id)} onChange={() => toggleBudgetParticipant(person.id)} disabled={saving} /><span><strong>{person.name}</strong><small>{person.profile_id ? "ログイン済み" : "仮登録"}</small></span></label><label className="budget-participant-amount"><span>個別予算</span><input type="number" min="0" step="100" value={participantBudgets[person.id] || ""} placeholder={budgetPerPerson ? money(budgetPerPerson) : "0"} onChange={(event) => setParticipantBudget(person.id, event.target.value)} disabled={!budgetParticipantIds.includes(person.id) || saving} /></label></div>)}{!budgetPeople.length && <p className="empty-state">参加者を登録すると予算対象を選べます。</p>}</div></details>
      <div className="category-budget-grid">{categories.map((category) => <label key={category}><span>{categoryLabel[category]}の配分予算</span><input type="number" min="0" step="100" value={categoryBudgets[category] || ""} placeholder="0" onChange={(event) => setCategoryBudget(category, event.target.value)} disabled={saving} /><small>見込み {money(budgetTotals.byCategory.find((item) => item.category === category)?.planned ?? 0)}</small></label>)}</div>
      <div className="budget-planner-metrics"><BudgetMetric label="予算合計" value={money(budgetTotals.total)} /><BudgetMetric label="予定総額" value={money(totals.forecast)} /><BudgetMetric label={budgetTotals.remaining < 0 ? "予算オーバー" : "残り予算"} value={money(Math.abs(budgetTotals.remaining))} tone={budgetTotals.remaining < 0 ? "over" : "remaining"} /><BudgetMetric label="対象人数" value={`${budgetTotals.participantCount}人`} /></div>
      <div className="category-budget-summary">{budgetTotals.byCategory.map((item) => <div key={item.category}><span>{categoryLabel[item.category]}</span><b>{money(item.planned)}</b>{item.budget > 0 && <small>／ {money(item.budget)}</small>}</div>)}</div>
    </section>

     </details>
    <h2 className="budget-title">支出を追加・編集</h2>
    <section className="panel finance-panel"><p className="finance-note">予定だけの費用も、支払済みの立替費用も同じ一覧で管理します。支払済みにすると実績額が精算へ反映されます。</p><div className="expense-entry-header"><div><h3>支出の入力</h3><p>内容・金額・状態を入力して、負担方法を選びます。</p></div><button type="button" className="add-button expense-add-button" onClick={() => setExpenseDraft(expenseDraft ? null : newExpenseDraft())} disabled={saving}>{expenseDraft ? "入力を閉じる" : "＋ 支出を追加"}</button></div>{expenseDraft && <form className="expense-form" onSubmit={saveExpense}><div className="fields"><label className="field"><span>内容</span><input required value={expenseDraft.title} onChange={(event) => setExpenseDraft({ ...expenseDraft, title: event.target.value })} placeholder="例：駐車場代" /></label><label className="field"><span>カテゴリ</span><select value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select></label><label className="field"><span>予定額</span><input type="number" min="0" value={expenseDraft.planned_amount || ""} placeholder="0" onChange={(event) => setExpenseDraft({ ...expenseDraft, planned_amount: amountOf(event.target.value) })} /></label><label className="field"><span>状態</span><select value={expenseDraft.payment_status} onChange={(event) => setExpenseDraft({ ...expenseDraft, payment_status: event.target.value as "unpaid" | "paid" })}><option value="unpaid">支払前・予定</option><option value="paid">支払済み・立替</option></select></label><label className="field"><span>実績額</span><input type="number" min="0" value={expenseDraft.actual_amount || ""} placeholder="0" onChange={(event) => setExpenseDraft({ ...expenseDraft, actual_amount: amountOf(event.target.value) })} disabled={expenseDraft.payment_status !== "paid"} /></label><label className="field"><span>支払った人</span><select value={expenseDraft.payer_id} onChange={(event) => setExpenseDraft({ ...expenseDraft, payer_id: event.target.value })}><option value="">未設定</option>{settlementPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="field"><span>関連する行程</span><select value={expenseDraft.itinerary_item_id} onChange={(event) => setExpenseDraft({ ...expenseDraft, itinerary_item_id: event.target.value })}><option value="">行程に紐づけない</option>{itinerary.map((item) => <option key={item.id} value={item.id}>{itineraryLabel(item)}</option>)}</select></label><label className="field"><span>メモ</span><input value={expenseDraft.memo} onChange={(event) => setExpenseDraft({ ...expenseDraft, memo: event.target.value })} placeholder="店名・区間・用途など" /></label></div><fieldset className="expense-allocation"><legend>負担方法</legend><div className="allocation-options">{(Object.keys(allocationLabel) as AllocationMethod[]).map((method) => <label key={method}><input type="radio" name="expense-allocation" checked={expenseDraft.allocation_method === method} onChange={() => setExpenseDraft({ ...expenseDraft, allocation_method: method })} />{allocationLabel[method]}</label>)}</div>{expenseDraft.allocation_method === "equal_selected" && <div className="participant-options">{settlementPeople.map((person) => <label key={person.id}><input type="checkbox" checked={expenseDraft.share_user_ids.includes(person.id)} onChange={() => toggleExpenseShare(person.id)} />{person.name}</label>)}</div>}{expenseDraft.allocation_method === "custom" && <div className="custom-share-list">{settlementPeople.map((person) => <label key={person.id}><span>{person.name}</span><input type="number" min="0" value={expenseDraft.share_amounts[person.id] || ""} placeholder="0" onChange={(event) => updateExpenseShareAmount(person.id, event.target.value)} /></label>)}</div>}{expenseDraft.allocation_method === "personal" && <p className="finance-note">支払った人を本人負担として登録します。</p>}</fieldset><div className="inline-actions"><button className="save-button" disabled={saving}>{saving ? "保存中…" : "費用を保存"}</button><button type="button" onClick={() => setExpenseDraft(null)} disabled={saving}>キャンセル</button></div></form>}
       <div className="finance-list">{expenses.map((expense) => { const linked = expenseItinerary(expense); return <div className="finance-expense unified-expense" key={expense.id}><div className="finance-expense-main"><strong>{expense.title}</strong><span>{categoryLabel[expense.category] ?? expense.category}｜{allocationLabel[expense.allocation_method] ?? expense.allocation_method}</span><span className="expense-payer">支払者：{nameOf(expense.payer_id)}{linked ? `｜${itineraryLabel(linked)}` : ""}</span>{expense.memo && <small>{expense.memo}</small>}</div><div className="expense-amount-summary"><span>予定 {money(expense.planned_amount)}</span><b>{expense.payment_status === "paid" ? `実績 ${money(expense.amount)}` : "支払前"}</b></div><small className={expense.payment_status === "paid" ? "expense-paid" : "expense-planned"}>{expense.payment_status === "paid" ? "支払済み" : "予定"}</small><button type="button" className="text-button" onClick={() => beginEditExpense(expense)} disabled={saving}>編集</button><button type="button" className="text-button danger" onClick={() => { const receipt = expense.receipt_id ? receipts.find((item) => item.id === expense.receipt_id) : null; if (receipt) void removeReceipt(receipt); else void removeExpense(expense); }} disabled={saving}>削除</button></div>; })}</div>{!expenses.length && <p className="empty-state">費用はまだありません。</p>}</section>

    <h2 className="budget-title">レシート付きで登録</h2>
    <section className="panel finance-panel"><form className="finance-form" onSubmit={submitReceipt}><div className="fields"><label className="field"><span>店名</span><input required value={receiptDraft.store_name} onChange={(event) => setReceiptDraft({ ...receiptDraft, store_name: event.target.value })} /></label><label className="field"><span>購入日</span><input type="date" value={receiptDraft.purchased_on} onChange={(event) => setReceiptDraft({ ...receiptDraft, purchased_on: event.target.value })} /></label><label className="field"><span>カテゴリ</span><select value={receiptDraft.category} onChange={(event) => setReceiptDraft({ ...receiptDraft, category: event.target.value })}><option value="receipt">レシート・混在</option>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select></label><label className="field"><span>立替えた人</span><select value={receiptDraft.payer_id} onChange={(event) => setReceiptDraft({ ...receiptDraft, payer_id: event.target.value })}><option value="">未設定</option>{settlementPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="field"><span>関連する行程</span><select value={receiptDraft.itinerary_item_id} onChange={(event) => setReceiptDraft({ ...receiptDraft, itinerary_item_id: event.target.value })}><option value="">行程に紐づけない</option>{itinerary.map((item) => <option key={item.id} value={item.id}>{itineraryLabel(item)}</option>)}</select></label><label className="field"><span>メモ</span><input value={receiptDraft.memo} onChange={(event) => setReceiptDraft({ ...receiptDraft, memo: event.target.value })} /></label></div><fieldset className="expense-allocation"><legend>負担者（均等割り）</legend><div className="participant-options">{settlementPeople.map((person) => <label key={person.id}><input type="checkbox" checked={receiptShareIds.includes(person.id)} onChange={() => toggleReceiptShare(person.id)} />{person.name}</label>)}</div></fieldset><div className="finance-items"><div className="finance-subheading"><h3>明細</h3><button type="button" className="text-button" onClick={() => setItems([...items, { name: "", category: "food", net_amount: 0, tax_rate: 0.1 }])}>＋ 明細を追加</button></div>{items.map((item, index) => <div className="finance-item" key={index}><input required placeholder="品目" value={item.name} onChange={(event) => updateReceiptItem(index, { name: event.target.value })} /><select value={item.category} onChange={(event) => updateReceiptItem(index, { category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select><input required type="number" min="0" placeholder="税抜" value={item.net_amount || ""} onChange={(event) => updateReceiptItem(index, { net_amount: amountOf(event.target.value) })} /><select value={item.tax_rate} onChange={(event) => updateReceiptItem(index, { tax_rate: Number(event.target.value) })}><option value="0.1">10%</option><option value="0.08">8%</option><option value="0">非課税</option></select></div>)}</div><p className="finance-note">登録時に税込額を実績額として費用一覧へ追加します。予定額と違う場合は、保存後に費用一覧から編集できます。</p><button className="save-button" disabled={saving}>レシートと費用を保存</button></form><div className="finance-subheading"><h3>登録済みレシート</h3></div><div className="finance-list">{receipts.map((receipt) => <div className="finance-receipt" key={receipt.id}><div className="finance-receipt-main"><strong>{receipt.store_name}</strong><span>{receipt.purchased_on || "購入日未設定"}｜立替えた人：{nameOf(receipt.payer_id)}</span>{receipt.memo && <small>{receipt.memo}</small>}</div><b>{money(receipt.items.reduce((sum, item) => sum + item.gross_amount, 0))}</b><button className="text-button danger" onClick={() => void removeReceipt(receipt)} disabled={saving}>削除</button></div>)}</div>{!receipts.length && <p className="empty-state">登録済みレシートはありません。</p>}</section>

    <h2 className="budget-title">行程に紐づく移動費</h2>
    <section className="panel finance-panel"><p className="finance-note">高速代・駐車場代などは、費用の「予定額」と「実績額」を分けて登録し、関連する行程へ紐づけられます。行程側の想定費用は、移動費を登録した区間ではその費用に置き換えて集計します。移動費を個別登録した区間では、ガソリン代も費用一覧へ登録してください。</p><div className="travel-cost-list">{itinerary.filter((item) => item.travel_estimated_cost > 0 || transportExpensesByItinerary.has(item.id)).map((item) => <div className="travel-cost-row" key={item.id}><div><strong>{itineraryLabel(item)}</strong><span>{item.travel_mode === "car" ? "車" : item.travel_mode || "移動"}</span></div><b>{money(transportExpensesByItinerary.get(item.id) ?? item.travel_estimated_cost)}</b><small>{transportExpensesByItinerary.has(item.id) ? "費用一覧から集計" : "行程の予定額"}</small></div>)}</div><div className="travel-total-row"><span>ガソリン見込（車の距離 ÷ 実燃費 × 単価）</span><b>{money(fuelForecast)}</b></div>{!itinerary.some((item) => item.travel_estimated_cost > 0 || transportExpensesByItinerary.has(item.id)) && !fuelForecast && <p className="empty-state">移動費の予定はまだありません。</p>}</section>

    <h2 className="budget-title">精算</h2>
    <section className="panel finance-panel"><p className="finance-note">支払済み費用の立替額と各人の負担額から、支払い回数が少なくなるように精算先を自動計算しています。</p><div className="settlement-list">{suggestions.map((suggestion) => <div className="settlement-row" key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}`}><span>{nameOf(suggestion.from)} → {nameOf(suggestion.to)}</span><b>{money(suggestion.amount)}</b><button className="save-button" onClick={() => void markSettlementPaid(suggestion)} disabled={saving}>支払済みにする</button></div>)}</div>{!suggestions.length && <p className="empty-state">現在、精算候補はありません。</p>}<div className="settlement-history">{settlements.filter((item) => item.status === "paid" && settlementParticipantIds.includes(item.from_user_id) && settlementParticipantIds.includes(item.to_user_id)).map((settlement) => <span key={settlement.id}>{nameOf(settlement.from_user_id)} → {nameOf(settlement.to_user_id)} {money(settlement.amount)} 済</span>)}</div></section>
    <TripTabs tripSlug={tripSlug} active="budget" />
  </main>;
}

function Summary({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={`summary-card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>; }
function BudgetMetric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <div className={`budget-planner-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
