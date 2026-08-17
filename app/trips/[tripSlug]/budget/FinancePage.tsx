"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type BudgetPerson = { id: string; name: string; profile_id: string | null };
type AllocationMethod = "equal_all" | "equal_selected" | "custom" | "personal";
type Expense = { id: string; transaction_id: string; merchant_name: string; purchased_on: string | null; itinerary_item_id: string | null; title: string; category: string; net_amount: number; tax_rate: number; tax_amount: number; planned_amount: number; amount: number; payer_id: string | null; payment_status: "unpaid" | "paid" | string; settlement_status: string; allocation_method: AllocationMethod; memo: string; version: number };
type Share = { expense_id: string; participant_id: string; amount: number };
type Settlement = { id: string; from_id: string; to_id: string; amount: number; status: string };
type Itinerary = { id: string; event_date: string | null; event_time: string | null; title: string; place: string; travel_origin: string; travel_destination: string; travel_distance_km: number; travel_estimated_cost: number; travel_mode: string };
type DraftItem = { id?: string; name: string; category: string; net_amount: number; tax_rate: number; planned_amount: number; actual_amount: number };
type ExpenseDraft = { id: string | null; version: number | null; transaction_id: string | null; merchant_name: string; purchased_on: string; itinerary_item_id: string; payment_status: "unpaid" | "paid"; payer_id: string; allocation_method: AllocationMethod; share_user_ids: string[]; share_amounts: Record<string, number>; memo: string; items: DraftItem[] };
type SettlementRow = { id: string; paidAmount: number; burdenAmount: number; before: number; remaining: number };
type SettlementData = { rows: SettlementRow[]; suggestions: { from: string; to: string; amount: number }[]; incompleteExpenses: { id: string; title: string; amount: number; reason: string }[]; unassignedPaid: number };

const categories = ["food", "equipment", "supplies", "lodging", "activity", "transport", "other"] as const;
const categoryLabel: Record<string, string> = { food: "食費", equipment: "備品", supplies: "消耗品", lodging: "宿泊", activity: "遊び", transport: "移動", other: "その他" };
const allocationLabel: Record<AllocationMethod, string> = { equal_all: "対象者全員で均等", equal_selected: "選択した人で均等", custom: "負担額を指定", personal: "個人負担" };
const money = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const amountOf = (value: unknown) => { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0; };
const decimalOf = (value: unknown) => { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? Math.max(0, number) : 0; };
const displayNumber = (value: number) => value === 0 ? "" : value;
const budgetSettingsOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const storedMap = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, amountOf(amount)])) : {} as Record<string, number>;
const storedCategoryMap = (settings: Record<string, unknown>) => storedMap(settings.categoryBudgets);
const expenseForecast = (expense: Expense) => expense.payment_status === "paid" ? amountOf(expense.amount) : amountOf(expense.planned_amount);
const taxAmountOf = (netAmount: number, taxRate: number) => Math.floor(amountOf(netAmount) * taxRate);
const grossAmountOf = (item: Pick<DraftItem, "net_amount" | "tax_rate">) => amountOf(item.net_amount) + taxAmountOf(item.net_amount, decimalOf(item.tax_rate));
const splitEvenly = (total: number, ids: string[]) => { const safeIds = [...new Set(ids)]; if (!safeIds.length) return {} as Record<string, number>; const base = Math.floor(Math.max(0, total) / safeIds.length); const remainder = Math.max(0, total) % safeIds.length; return Object.fromEntries(safeIds.map((id, index) => [id, base + (index < remainder ? 1 : 0)])); };
const allocateGroupShares = (itemTotals: number[], participantIds: string[], participantTotals: Record<string, number>) => {
  const result = itemTotals.map(() => Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>); let itemIndex = 0; let itemRemaining = itemTotals[0] ?? 0;
  for (const participantId of participantIds) { let participantRemaining = amountOf(participantTotals[participantId]); while (participantRemaining > 0 && itemIndex < itemTotals.length) { if (itemRemaining <= 0) { itemIndex += 1; itemRemaining = itemTotals[itemIndex] ?? 0; continue; } const allocated = Math.min(participantRemaining, itemRemaining); result[itemIndex][participantId] = (result[itemIndex][participantId] ?? 0) + allocated; participantRemaining -= allocated; itemRemaining -= allocated; } }
  return result;
};

export default function FinancePage({ tripId, tripSlug, tripName, avatarUrl = null, userId }: { tripId: string; tripSlug: string; tripName: string; avatarUrl?: string | null; userId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [budgetPeople, setBudgetPeople] = useState<BudgetPerson[]>([]);
  const [budgetParticipantIds, setBudgetParticipantIds] = useState<string[]>([]);
  const [settlementParticipantIds, setSettlementParticipantIds] = useState<string[]>([]);
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
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string | null) => budgetPeople.find((person) => person.id === id)?.name ?? "未設定";
  const itineraryLabel = (item: Itinerary) => { const route = [item.travel_origin, item.travel_destination].filter(Boolean).join(" → "); return route || [item.event_date?.replaceAll("-", "/"), item.event_time?.slice(0, 5), item.title, item.place].filter(Boolean).join("｜"); };
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
    const savedSettlementParticipantIds = resolveSavedParticipants(savedBudget.settlementParticipantIds, savedBudgetPeople.map((person) => person.id));
    const savedParticipantIds = resolveSavedParticipants(savedBudget.budgetParticipantIds, savedBudgetPeople.map((person) => person.id));
    const savedParticipantBudgets = storedMap(savedBudget.participantBudgets);
    const legacyPerPerson = amountOf(savedBudget.budgetPerPerson);
    const initialBudgets = Object.keys(savedParticipantBudgets).length ? savedParticipantBudgets : legacyPerPerson ? Object.fromEntries(savedBudgetPeople.map((person) => [person.id, legacyPerPerson])) : {};
    const initialValues = Object.values(initialBudgets);
    setBudgetPeople(savedBudgetPeople); setBudgetParticipantIds(savedParticipantIds); setSettlementParticipantIds(savedSettlementParticipantIds); setParticipantBudgets(initialBudgets);
    setBudgetPerPerson(legacyPerPerson || (initialValues.length && initialValues.every((value) => value === initialValues[0]) ? initialValues[0] : 0));
    setCategoryBudgets(storedCategoryMap(savedBudget));
    if (!budgetDirty) { setFuelPrice(amountOf(savedBudget.fuelPrice ?? savedBudget.gasPrice) || 175); setFuelEfficiency(decimalOf(savedBudget.fuelEfficiency ?? savedBudget.efficiency) || 18); }
    setSettingsVersion(settingsResult.data?.version ?? null); setBudgetReady(true);
    setExpenses((expenseResult.data ?? []).map((expense) => ({ ...expense, payer_id: expense.payer_participant_id, allocation_method: (expense.allocation_method || "equal_selected") as AllocationMethod })));
    setShares((shareResult.data ?? []).filter((share) => Boolean(share.participant_id)).map((share) => ({ expense_id: share.expense_id, participant_id: share.participant_id, amount: share.amount })));
    setSettlements((settlementResult.data ?? []).filter((settlement) => settlement.from_participant_id && settlement.to_participant_id).map((settlement) => ({ id: settlement.id, from_id: settlement.from_participant_id, to_id: settlement.to_participant_id, amount: settlement.amount, status: settlement.status })));
    setItinerary(itineraryResult.data ?? []); setStatus(message);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [tripId]);
  useEffect(() => {
    if (!expenseDraft?.id) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLFormElement>(".expense-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [expenseDraft?.id]);

  const transportExpensesByItinerary = useMemo(() => {
    const result = new Map<string, number>();
    for (const expense of expenses) { if (expense.category !== "transport" || !expense.itinerary_item_id) continue; result.set(expense.itinerary_item_id, (result.get(expense.itinerary_item_id) ?? 0) + expenseForecast(expense)); }
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
    const byCategory = categories.map((category) => { const expenseTotal = expenses.filter((expense) => expense.category === category && !(category === "transport" && expense.itinerary_item_id && transportExpensesByItinerary.has(expense.itinerary_item_id))).reduce((sum, expense) => sum + expenseForecast(expense), 0); return { category, planned: expenseTotal + (category === "transport" ? travelForecast : 0), budget: amountOf(categoryBudgets[category]) }; });
    return { total, participantCount: selectedPeople.length, remaining: total - totals.forecast, byCategory };
  }, [budgetParticipantIds, budgetPeople, budgetPerPerson, categoryBudgets, expenses, participantBudgets, totals.forecast, transportExpensesByItinerary, travelForecast]);
  const settlementPeople = useMemo(() => { const selected = new Set(settlementParticipantIds); return budgetPeople.filter((person) => selected.has(person.id)); }, [budgetPeople, settlementParticipantIds]);
  const settlementData = useMemo<SettlementData>(() => {
    const selected = new Set(settlementParticipantIds);
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
      else if (shareTotal !== amountOf(expense.amount)) reason = `負担額の合計が${money(shareTotal)}（実績${money(expense.amount)}）`;
      else if (expenseShares.some((share) => !selected.has(share.participant_id))) reason = "負担者に精算対象外の参加者が含まれる";
       const payerId = expense.payer_id;
       if (reason || !payerId) { if (reason) incompleteExpenses.push({ id: expense.id, title: expense.title, amount: amountOf(expense.amount), reason }); continue; }
       eligiblePaidBy.set(payerId, (eligiblePaidBy.get(payerId) ?? 0) + amountOf(expense.amount));
      for (const share of expenseShares) eligibleBurdenBy.set(share.participant_id, (eligibleBurdenBy.get(share.participant_id) ?? 0) + amountOf(share.amount));
    }
    for (const settlement of settlements.filter((item) => item.status === "paid" && selected.has(item.from_id) && selected.has(item.to_id))) { adjustmentBy.set(settlement.from_id, (adjustmentBy.get(settlement.from_id) ?? 0) + amountOf(settlement.amount)); adjustmentBy.set(settlement.to_id, (adjustmentBy.get(settlement.to_id) ?? 0) - amountOf(settlement.amount)); }
    const rows = settlementPeople.map((person) => { const paidAmount = paidBy.get(person.id) ?? 0; const burdenAmount = burdenBy.get(person.id) ?? 0; const before = (eligiblePaidBy.get(person.id) ?? 0) - (eligibleBurdenBy.get(person.id) ?? 0); return { id: person.id, paidAmount, burdenAmount, before, remaining: before + (adjustmentBy.get(person.id) ?? 0) }; });
    const debtors = rows.filter((row) => row.remaining < 0).map((row) => ({ id: row.id, amount: -row.remaining }));
    const creditors = rows.filter((row) => row.remaining > 0).map((row) => ({ id: row.id, amount: row.remaining }));
    const suggestions: SettlementData["suggestions"] = [];
    let debtorIndex = 0; let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) { const amount = Math.min(debtors[debtorIndex].amount, creditors[creditorIndex].amount); suggestions.push({ from: debtors[debtorIndex].id, to: creditors[creditorIndex].id, amount }); debtors[debtorIndex].amount -= amount; creditors[creditorIndex].amount -= amount; if (debtors[debtorIndex].amount === 0) debtorIndex += 1; if (creditors[creditorIndex].amount === 0) creditorIndex += 1; }
    return { rows, suggestions, incompleteExpenses, unassignedPaid };
  }, [expenses, settlementParticipantIds, settlementPeople, shares, settlements]);
  const saveBudget = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !budgetReady) return;
    setSaving(true);
    const nextBudget = { budgetPerPerson: amountOf(budgetPerPerson), budgetParticipantIds, participantBudgets, categoryBudgets, settlementParticipantIds, fuelPrice: amountOf(fuelPrice), fuelEfficiency: Math.max(1, decimalOf(fuelEfficiency)) };
    const result = settingsVersion === null ? await supabase.from("trip_settings").insert({ trip_id: tripId, budget: nextBudget, updated_by: userId }).select("version").maybeSingle<{ version: number }>() : await supabase.from("trip_settings").update({ budget: nextBudget, updated_by: userId }).eq("trip_id", tripId).eq("version", settingsVersion).select("version").maybeSingle<{ version: number }>();
    setSaving(false);
    if (result.error || !result.data) { await load(result.error?.code === "23505" ? "他の人が先に予算を保存しました" : "予算を保存できませんでした"); return; }
    setSettingsVersion(result.data.version); setBudgetDirty(false); setStatus("予算を保存しました");
  };
  const toggleBudgetParticipant = (id: string) => setBudgetParticipantIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleSettlementParticipant = (id: string) => setSettlementParticipantIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const setParticipantBudget = (id: string, value: string) => { setParticipantBudgets((current) => ({ ...current, [id]: amountOf(value) })); setBudgetDirty(true); };
  const setCategoryBudget = (category: string, value: string) => { setCategoryBudgets((current) => ({ ...current, [category]: amountOf(value) })); setBudgetDirty(true); };
  const newExpenseDraft = (): ExpenseDraft => ({ id: null, version: null, transaction_id: null, merchant_name: "", purchased_on: today(), itinerary_item_id: "", payment_status: "unpaid", payer_id: "", allocation_method: "equal_selected", share_user_ids: settlementPeople.map((person) => person.id), share_amounts: splitEvenly(0, settlementPeople.map((person) => person.id)), memo: "", items: [{ name: "", category: "food", net_amount: 0, tax_rate: 0.1, planned_amount: 0, actual_amount: 0 }] });
  const draftItemAmount = (item: DraftItem, paymentStatus: "unpaid" | "paid") => paymentStatus === "paid" ? amountOf(item.actual_amount || grossAmountOf(item)) : amountOf(item.planned_amount || grossAmountOf(item));
  const beginEditExpense = (expense: Expense) => {
    const expenseShares = shares.filter((share) => share.expense_id === expense.id);
    const fallbackNet = expense.payment_status === "paid" ? expense.amount : expense.planned_amount;
    setExpenseDraft({ id: expense.id, version: expense.version, transaction_id: expense.transaction_id, merchant_name: expense.merchant_name, purchased_on: expense.purchased_on ?? "", itinerary_item_id: expense.itinerary_item_id ?? "", payment_status: expense.payment_status === "paid" ? "paid" : "unpaid", payer_id: expense.payer_id ?? "", allocation_method: expense.allocation_method, share_user_ids: expenseShares.length ? expenseShares.map((share) => share.participant_id) : settlementPeople.map((person) => person.id), share_amounts: Object.fromEntries(expenseShares.map((share) => [share.participant_id, share.amount])), memo: expense.memo, items: [{ id: expense.id, name: expense.title, category: expense.category, net_amount: expense.net_amount || fallbackNet, tax_rate: Number(expense.tax_rate || 0), planned_amount: expense.planned_amount, actual_amount: expense.amount }] });
  };
  const updateDraftItem = (index: number, patch: Partial<DraftItem>) => setExpenseDraft((current) => {
    if (!current) return current;
    const nextItems = current.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const nextItem = { ...item, ...patch };
      if (patch.net_amount !== undefined || patch.tax_rate !== undefined) { const gross = grossAmountOf(nextItem); nextItem.planned_amount = current.payment_status === "unpaid" ? gross : nextItem.planned_amount || gross; nextItem.actual_amount = current.payment_status === "paid" ? gross : 0; }
      return nextItem;
    });
    return { ...current, items: nextItems };
  });
  const changePaymentStatus = (paymentStatus: "unpaid" | "paid") => setExpenseDraft((current) => current ? { ...current, payment_status: paymentStatus, payer_id: paymentStatus === "paid" ? current.payer_id : "", allocation_method: paymentStatus === "unpaid" && current.allocation_method === "personal" ? "equal_selected" : current.allocation_method, items: current.items.map((item) => { const gross = grossAmountOf(item); return { ...item, planned_amount: item.planned_amount || gross, actual_amount: paymentStatus === "paid" ? item.actual_amount || gross : 0 }; }) } : current);
  const toggleExpenseShare = (id: string) => setExpenseDraft((current) => current ? { ...current, share_user_ids: current.share_user_ids.includes(id) ? current.share_user_ids.filter((value) => value !== id) : [...current.share_user_ids, id] } : current);
  const updateExpenseShareAmount = (id: string, value: string) => setExpenseDraft((current) => current ? { ...current, share_amounts: { ...current.share_amounts, [id]: amountOf(value) } } : current);
  const removeDraftItem = (index: number) => setExpenseDraft((current) => current && current.items.length > 1 ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current);
  const saveExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !expenseDraft) return;
    const validItems = expenseDraft.items.filter((item) => item.name.trim() && draftItemAmount(item, expenseDraft.payment_status) > 0);
    if (validItems.length !== expenseDraft.items.length) { setStatus("明細名と金額をすべて入力してください"); return; }
    if (expenseDraft.payment_status === "paid" && !expenseDraft.payer_id) { setStatus("支払済みの場合は支払者を選択してください"); return; }
    const selectedIds = expenseDraft.allocation_method === "equal_all" ? settlementPeople.map((person) => person.id) : expenseDraft.allocation_method === "personal" ? (expenseDraft.payer_id ? [expenseDraft.payer_id] : []) : expenseDraft.allocation_method === "custom" ? settlementPeople.map((person) => person.id).filter((id) => Object.prototype.hasOwnProperty.call(expenseDraft.share_amounts, id) && amountOf(expenseDraft.share_amounts[id]) > 0) : expenseDraft.share_user_ids.filter((id) => settlementParticipantIds.includes(id));
    const itemTotals = validItems.map((item) => draftItemAmount(item, expenseDraft.payment_status));
    const total = itemTotals.reduce((sum, amount) => sum + amount, 0);
    if (!selectedIds.length) { setStatus("負担者を1人以上選択してください"); return; }
    const shareTotals = expenseDraft.allocation_method === "custom" ? Object.fromEntries(selectedIds.map((id) => [id, amountOf(expenseDraft.share_amounts[id])])) : expenseDraft.allocation_method === "personal" ? { [expenseDraft.payer_id]: total } : splitEvenly(total, selectedIds);
    if (Object.values(shareTotals).reduce((sum, amount) => sum + amount, 0) !== total) { setStatus(`負担額の合計を${money(total)}にしてください`); return; }
    const itemShares = allocateGroupShares(itemTotals, selectedIds, shareTotals);
    const itemInputs = validItems.map((item, index) => { const gross = itemTotals[index]; return { title: item.name.trim(), category: item.category, planned_amount: expenseDraft.payment_status === "unpaid" ? gross : amountOf(item.planned_amount || gross), actual_amount: expenseDraft.payment_status === "paid" ? gross : 0, net_amount: amountOf(item.net_amount), tax_rate: decimalOf(item.tax_rate), share_amounts: itemShares[index], memo: expenseDraft.memo.trim() }; });
    const payerId = expenseDraft.payment_status === "paid" ? expenseDraft.payer_id : null;
    const allocationMethod = expenseDraft.allocation_method === "equal_all" ? "equal_selected" : expenseDraft.allocation_method;
    setSaving(true);
    const result = expenseDraft.id ? await supabase.rpc("save_expense_with_shares", { target_trip_id: tripId, target_expense_id: expenseDraft.id, expected_version: expenseDraft.version, input_title: itemInputs[0].title, input_category: itemInputs[0].category, input_planned_amount: itemInputs[0].planned_amount, input_actual_amount: itemInputs[0].actual_amount, input_payment_status: expenseDraft.payment_status, input_payer_id: payerId, input_itinerary_item_id: expenseDraft.itinerary_item_id || null, input_transaction_id: expenseDraft.transaction_id, input_merchant_name: expenseDraft.merchant_name.trim(), input_purchased_on: expenseDraft.purchased_on || null, input_net_amount: itemInputs[0].net_amount, input_tax_rate: itemInputs[0].tax_rate, input_allocation_method: allocationMethod, input_share_user_ids: selectedIds, input_share_amounts: itemInputs[0].share_amounts, input_memo: expenseDraft.memo.trim() }) : await supabase.rpc("create_expense_batch_with_shares", { target_trip_id: tripId, input_transaction_id: null, input_merchant_name: expenseDraft.merchant_name.trim(), input_purchased_on: expenseDraft.purchased_on || null, input_itinerary_item_id: expenseDraft.itinerary_item_id || null, input_payment_status: expenseDraft.payment_status, input_payer_id: payerId, input_allocation_method: allocationMethod, input_share_user_ids: selectedIds, input_items: itemInputs, input_memo: expenseDraft.memo.trim() });
    setSaving(false);
    const resultStatus = (result.data as { status?: string } | null)?.status;
    if (result.error || resultStatus !== "ok") { setStatus(resultStatus === "payer_required" ? "支払済みの場合は支払者を選択してください" : "費用を保存できませんでした"); return; }
    setExpenseDraft(null); await load(expenseDraft.id ? "費用を更新しました" : `${validItems.length}件の費用を登録しました`);
  };
  const removeExpense = async (expense: Expense) => { if (!supabase || !window.confirm(`「${expense.title}」を削除しますか？`)) return; setSaving(true); const { error } = await supabase.from("expenses").delete().eq("id", expense.id).eq("version", expense.version); setSaving(false); await load(error ? "費用を削除できませんでした" : "費用を削除しました"); };
  const markSettlementPaid = async (suggestion: { from: string; to: string; amount: number }) => { if (!supabase) return; setSaving(true); const { error } = await supabase.from("settlements").insert({ trip_id: tripId, from_participant_id: suggestion.from, to_participant_id: suggestion.to, amount: suggestion.amount, status: "paid", created_by: userId }); setSaving(false); await load(error ? "精算記録を保存できませんでした" : "精算済みとして記録しました"); };
  const expenseItinerary = (expense: Expense) => expense.itinerary_item_id ? itinerary.find((item) => item.id === expense.itinerary_item_id) : null;
  const draftTotals = expenseDraft ? expenseDraft.items.reduce((summary, item) => { const gross = draftItemAmount(item, expenseDraft.payment_status); return { net: summary.net + amountOf(item.net_amount), tax: summary.tax + taxAmountOf(item.net_amount, decimalOf(item.tax_rate)), gross: summary.gross + gross }; }, { net: 0, tax: 0, gross: 0 }) : { net: 0, tax: 0, gross: 0 };
  const unpaidExpenses = expenses.filter((expense) => expense.payment_status !== "paid");
  const paidExpenses = expenses.filter((expense) => expense.payment_status === "paid");
  const renderExpense = (expense: Expense) => {
    const linked = expenseItinerary(expense);
    const expenseBurden = shares.filter((share) => share.expense_id === expense.id).reduce((sum, share) => sum + amountOf(share.amount), 0);
    const paid = expense.payment_status === "paid";
    return <div className="finance-expense unified-expense" key={expense.id}><div className="finance-expense-main"><strong>{expense.title}</strong><span>{categoryLabel[expense.category] ?? expense.category}{expense.merchant_name ? `｜${expense.merchant_name}` : ""}{expense.purchased_on ? `｜${expense.purchased_on.replaceAll("-", "/")}` : ""}</span><span className="expense-payer">{paid ? `支払者：${nameOf(expense.payer_id)}` : "支払者：なし（支払い前）"}{linked ? `｜${itineraryLabel(linked)}` : ""}</span>{expense.net_amount > 0 && <small>税抜 {money(expense.net_amount)}＋税 {money(expense.tax_amount)}（{Math.round(Number(expense.tax_rate) * 100)}%）</small>}{expense.memo && <small>{expense.memo}</small>}</div><div className="expense-amount-summary"><span>予定 {money(expense.planned_amount)}</span><b>{paid ? `実績 ${money(expense.amount)}` : `予定 ${money(expense.planned_amount)}`}</b><small>負担登録 {money(expenseBurden)}</small></div><small className={paid ? "expense-paid" : "expense-planned"}>{paid ? (expense.payer_id ? "支払済み・精算対象候補" : "支払済み・精算未確定") : "支払い前・予算のみ"}</small><button type="button" className="text-button" onClick={() => beginEditExpense(expense)} disabled={saving}>編集</button><button type="button" className="text-button danger" onClick={() => void removeExpense(expense)} disabled={saving}>削除</button></div>;
  };

  return <main className="budget-shell finance-shell"><TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} /><p className="save-status" role="status">{status}</p>
    <section className="budget-hero"><p className="kicker">COST & SETTLEMENT</p><h1>費用と精算</h1><p>{tripName}</p></section>
    <section className="summary-grid finance-summary"><Summary label="1人あたり予算" value={budgetTotals.participantCount ? budgetTotals.total / budgetTotals.participantCount : 0} /><Summary label="予定総額" value={totals.forecast} /><Summary label="支払済み・立替" value={totals.actual} tone="paid" /><Summary label={budgetTotals.remaining < 0 ? "予算オーバー" : "予算残額"} value={Math.abs(budgetTotals.remaining)} tone={budgetTotals.remaining < 0 ? "due" : ""} /><Summary label="未払い予定" value={totals.plannedOnly} /><Summary label="精算候補" value={settlementData.suggestions.reduce((sum, item) => sum + item.amount, 0)} tone="due" /></section>
    <p className="finance-summary-note">予算は上限・目標、支払い前は予算だけ、支払い済みは実績と精算の対象です。予定総額は支払済み実績・未払い予定・行程の移動費を合計します。</p>
    <details className="settlement-scope-settings"><summary>費用・精算の対象者（{settlementParticipantIds.length}/{budgetPeople.length}人）</summary><form className="settlement-scope-form" onSubmit={saveBudget}><p>旅行の後半だけ参加する人など、費用と精算から外したい人のチェックを外してください。</p><div className="settlement-scope-list">{budgetPeople.map((person) => <label key={person.id}><input type="checkbox" checked={settlementParticipantIds.includes(person.id)} onChange={() => toggleSettlementParticipant(person.id)} disabled={saving || settlementParticipantIds.length === 1 && settlementParticipantIds.includes(person.id)} /><span>{person.name}</span></label>)}</div><button className="save-button" disabled={!budgetReady || saving}>{saving ? "保存中…" : "対象者設定を保存"}</button></form></details>
    <h2 className="budget-title">予算設定</h2>
    <details className="budget-settings-drawer"><summary><span>予算の詳細設定</span><small>1人あたり・カテゴリ別・燃料設定</small></summary><section className="panel budget-planner"><div className="budget-planner-heading"><div><h3>1人あたりの予算と項目別配分</h3><p>参加者ごとの予算を合計し、支払い前の予定額と支払済みの実績額を同じ予算から差し引きます。</p></div><form className="budget-planner-form unified-budget-form" onSubmit={saveBudget}><label><span>基本の1人あたり予算</span><input type="number" min="0" step="100" value={displayNumber(budgetPerPerson)} placeholder="0" onChange={(event) => { setBudgetPerPerson(amountOf(event.target.value)); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><label><span>ガソリン単価（円/L）</span><input type="number" min="0" step="1" value={displayNumber(fuelPrice)} placeholder="0" onChange={(event) => { setFuelPrice(amountOf(event.target.value)); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><label><span>実燃費（km/L）</span><input type="number" min="1" step="0.1" value={displayNumber(fuelEfficiency)} placeholder="18" onChange={(event) => { setFuelEfficiency(event.target.value === "" ? 0 : Math.max(1, decimalOf(event.target.value))); setBudgetDirty(true); }} disabled={!budgetReady || saving} /></label><button className="save-button" disabled={!budgetReady || saving}>{saving ? "保存中…" : "予算を保存"}</button></form></div>
      <details className="budget-participant-settings"><summary>予算に含める参加者と個別調整（{budgetParticipantIds.length}/{budgetPeople.length}人）</summary><div className="budget-participant-list"><div className="budget-participant-heading"><strong>予算対象の参加者</strong><span>個別予算を空欄にすると基本予算を使用</span></div>{budgetPeople.map((person) => <div className="budget-participant-row" key={person.id}><label className="budget-participant-check"><input type="checkbox" checked={budgetParticipantIds.includes(person.id)} onChange={() => toggleBudgetParticipant(person.id)} disabled={saving} /><span><strong>{person.name}</strong><small>{person.profile_id ? "ログイン済み" : "仮登録"}</small></span></label><label className="budget-participant-amount"><span>個別予算</span><input type="number" min="0" step="100" value={participantBudgets[person.id] || ""} placeholder={budgetPerPerson ? money(budgetPerPerson) : "0"} onChange={(event) => setParticipantBudget(person.id, event.target.value)} disabled={!budgetParticipantIds.includes(person.id) || saving} /></label></div>)}{!budgetPeople.length && <p className="empty-state">参加者を登録すると予算対象を選べます。</p>}</div></details>
      <div className="category-budget-grid">{categories.map((category) => <label key={category}><span>{categoryLabel[category]}の配分予算</span><input type="number" min="0" step="100" value={categoryBudgets[category] || ""} placeholder="0" onChange={(event) => setCategoryBudget(category, event.target.value)} disabled={saving} /><small>見込み {money(budgetTotals.byCategory.find((item) => item.category === category)?.planned ?? 0)}</small></label>)}</div>
      <div className="budget-planner-metrics"><BudgetMetric label="予算合計" value={money(budgetTotals.total)} /><BudgetMetric label="予定総額" value={money(totals.forecast)} /><BudgetMetric label={budgetTotals.remaining < 0 ? "予算オーバー" : "残り予算"} value={money(Math.abs(budgetTotals.remaining))} tone={budgetTotals.remaining < 0 ? "over" : "remaining"} /><BudgetMetric label="対象人数" value={`${budgetTotals.participantCount}人`} /></div><div className="category-budget-summary">{budgetTotals.byCategory.map((item) => <div key={item.category}><span>{categoryLabel[item.category]}</span><b>{money(item.planned)}</b>{item.budget > 0 && <small>／ {money(item.budget)}</small>}</div>)}</div>
    </section></details>
    <h2 className="budget-title">支払い・予定を登録</h2>
    <section className="panel finance-panel"><p className="finance-note">ここで支払い前の予定と支払済みの実績を一元管理します。支払い前は支払者なしで予算だけに反映し、支払済みにしたら支払者が必須になり、精算へ反映されます。明細は1行ごとに別の費用として登録されます。</p><div className="expense-entry-header"><div><h3>費用の入力</h3><p>税抜金額と税率から税込額を自動計算します。複数明細は同じ支払いとして登録します。</p></div><button type="button" className="add-button expense-add-button" onClick={() => setExpenseDraft(expenseDraft ? null : newExpenseDraft())} disabled={saving}>{expenseDraft ? "入力を閉じる" : "＋ 支出を追加"}</button></div>
      {expenseDraft && <form className="expense-form" onSubmit={saveExpense}>
        <div className="fields">
          <label className="field"><span>支払先・店名</span><input value={expenseDraft.merchant_name} onChange={(event) => setExpenseDraft({ ...expenseDraft, merchant_name: event.target.value })} placeholder="例：道の駅・高速道路" /></label>
          <label className="field"><span>利用日</span><input type="date" value={expenseDraft.purchased_on} onChange={(event) => setExpenseDraft({ ...expenseDraft, purchased_on: event.target.value })} /></label>
          <label className="field"><span>状態</span><select value={expenseDraft.payment_status} onChange={(event) => changePaymentStatus(event.target.value as "unpaid" | "paid")}><option value="unpaid">支払い前・予定</option><option value="paid">支払済み</option></select></label>
          <label className="field"><span>支払者</span><select value={expenseDraft.payer_id} disabled={expenseDraft.payment_status !== "paid"} onChange={(event) => setExpenseDraft({ ...expenseDraft, payer_id: event.target.value })}><option value="">未設定（支払い前）</option>{settlementPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{expenseDraft.payment_status === "paid" && !expenseDraft.payer_id && <small className="field-hint">支払済みにするには必須です</small>}</label>
          <label className="field"><span>関連する行程</span><select value={expenseDraft.itinerary_item_id} onChange={(event) => setExpenseDraft({ ...expenseDraft, itinerary_item_id: event.target.value })}><option value="">行程に紐づけない</option>{itinerary.map((item) => <option key={item.id} value={item.id}>{itineraryLabel(item)}</option>)}</select></label>
          <label className="field"><span>メモ</span><input value={expenseDraft.memo} onChange={(event) => setExpenseDraft({ ...expenseDraft, memo: event.target.value })} placeholder="用途・区間など" /></label>
        </div>
        <div className="finance-items">
          <div className="finance-subheading"><div><h3>明細</h3><small className="finance-note-inline">1行ごとに別の費用として登録されます</small></div><button type="button" className="text-button" onClick={() => setExpenseDraft({ ...expenseDraft, items: [...expenseDraft.items, { name: "", category: "food", net_amount: 0, tax_rate: 0.1, planned_amount: 0, actual_amount: 0 }] })} disabled={saving}>＋ 明細を追加</button></div>
          {expenseDraft.items.map((item, index) => <div className="finance-item" key={item.id ?? index}>
            <input required placeholder="品目・用途" value={item.name} onChange={(event) => updateDraftItem(index, { name: event.target.value })} />
            <select value={item.category} onChange={(event) => updateDraftItem(index, { category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select>
            <input required type="number" min="0" step="1" placeholder="税抜金額" value={item.net_amount || ""} onChange={(event) => updateDraftItem(index, { net_amount: amountOf(event.target.value) })} />
            <select value={item.tax_rate} onChange={(event) => updateDraftItem(index, { tax_rate: Number(event.target.value) })}><option value="0.1">10%</option><option value="0.08">8%</option><option value="0">非課税</option></select>
            <span className="expense-item-total">税込 {money(grossAmountOf(item))}</span>
            {expenseDraft.items.length > 1 && <button type="button" className="text-button danger" onClick={() => removeDraftItem(index)} disabled={saving}>削除</button>}
          </div>)}
        </div>
        <div className="expense-items-total"><span>登録額（税込）</span><strong>{money(draftTotals.gross)}</strong><small>税抜 {money(draftTotals.net)}＋税 {money(draftTotals.tax)}</small></div>
        <fieldset className="expense-allocation">
          <legend>{expenseDraft.payment_status === "paid" ? "負担者" : "負担予定者"}</legend>
          <p className="finance-note">{expenseDraft.payment_status === "paid" ? "この支払済み費用を誰が負担するか確認・変更してください。" : "支払い前でも負担予定は決めておけます。支払者は支払済みにした時点で設定します。"}</p>
          <div className="allocation-options">{(Object.keys(allocationLabel) as AllocationMethod[]).map((method) => <label key={method}><input type="radio" name={`expense-allocation-${expenseDraft.id ?? "new"}`} checked={expenseDraft.allocation_method === method} disabled={expenseDraft.payment_status !== "paid" && method === "personal"} onChange={() => setExpenseDraft({ ...expenseDraft, allocation_method: method })} />{allocationLabel[method]}</label>)}</div>
          {expenseDraft.allocation_method === "equal_all" && <p className="finance-note">精算対象に設定した参加者全員で均等に負担します。</p>}
          {expenseDraft.allocation_method === "equal_selected" && <div className="participant-options">{settlementPeople.map((person) => <label key={person.id}><input type="checkbox" checked={expenseDraft.share_user_ids.includes(person.id)} onChange={() => toggleExpenseShare(person.id)} /><span>{person.name}</span></label>)}</div>}
          {expenseDraft.allocation_method === "custom" && <div className="custom-share-list">{settlementPeople.map((person) => <label key={person.id}><span>{person.name}</span><input type="number" min="0" step="1" value={expenseDraft.share_amounts[person.id] ?? ""} placeholder="0" onChange={(event) => updateExpenseShareAmount(person.id, event.target.value)} /></label>)}</div>}
          {expenseDraft.allocation_method === "personal" && <p className="finance-note">支払者本人の個人負担として登録します。支払済みの場合だけ選択できます。</p>}
        </fieldset>
        <div className="inline-actions"><button className="save-button" disabled={saving}>{saving ? "保存中…" : "費用を保存"}</button><button type="button" onClick={() => setExpenseDraft(null)} disabled={saving}>キャンセル</button></div>
      </form>}
      <div className="expense-status-columns">
        <section className="expense-status-section"><div className="finance-subheading"><h3>支払い前・予定</h3><small>支払者なし／予算に反映</small></div><div className="finance-list">{unpaidExpenses.map(renderExpense)}</div>{!unpaidExpenses.length && <p className="empty-state">支払い前の予定はありません。</p>}</section>
        <section className="expense-status-section"><div className="finance-subheading"><h3>支払済み</h3><small>支払者必須／精算候補</small></div><div className="finance-list">{paidExpenses.map(renderExpense)}</div>{!paidExpenses.length && <p className="empty-state">支払済みの費用はありません。</p>}</section>
      </div>
    </section>

    <h2 className="budget-title">行程に紐づく移動費</h2>
    <section className="panel finance-panel"><p className="finance-note">高速代・駐車場代などは費用の「予定額」と「実績額」を分けて管理し、関連する行程へ紐づけられます。移動費を個別登録した区間は、その費用を行程の想定額として集計します。</p><div className="travel-cost-list">{itinerary.filter((item) => item.travel_estimated_cost > 0 || transportExpensesByItinerary.has(item.id)).map((item) => <div className="travel-cost-row" key={item.id}><div><strong>{itineraryLabel(item)}</strong><span>{item.travel_mode === "car" ? "車" : item.travel_mode || "移動"}</span></div><b>{money(transportExpensesByItinerary.get(item.id) ?? item.travel_estimated_cost)}</b><small>{transportExpensesByItinerary.has(item.id) ? "費用一覧から集計" : "行程の予定額"}</small></div>)}</div><div className="travel-total-row"><span>ガソリン見込（車の距離 ÷ 実燃費 × 単価）</span><b>{money(fuelForecast)}</b></div>{!itinerary.some((item) => item.travel_estimated_cost > 0 || transportExpensesByItinerary.has(item.id)) && !fuelForecast && <p className="empty-state">移動費の予定はまだありません。</p>}</section>

    <h2 className="budget-title">精算</h2>
    <section className="panel finance-panel"><p className="finance-note">「支払った額 − 負担額 ＝ 精算前差額」です。支払い前の予定は精算に入りません。下の支払額・負担額は登録済みの支払済み費用、差額と送金候補は精算条件を満たした費用から計算しています。</p>
      <div className="settlement-breakdown"><div className="finance-subheading"><div><h3>参加者別の支払い・負担内訳</h3><small className="finance-note-inline">精算対象者のみ表示</small></div></div><div className="settlement-table-wrap"><table className="settlement-table"><thead><tr><th scope="col">参加者</th><th scope="col">支払った額</th><th scope="col">負担額</th><th scope="col">精算前差額</th><th scope="col">精算後残額</th></tr></thead><tbody>{settlementData.rows.map((row) => <tr key={row.id}><th scope="row">{nameOf(row.id)}</th><td>{money(row.paidAmount)}</td><td>{money(row.burdenAmount)}</td><td className={row.before > 0 ? "settlement-positive" : row.before < 0 ? "settlement-negative" : ""}>{row.before > 0 ? `受取 ${money(row.before)}` : row.before < 0 ? `支払 ${money(-row.before)}` : "± ￥0"}</td><td className={row.remaining > 0 ? "settlement-positive" : row.remaining < 0 ? "settlement-negative" : ""}>{row.remaining > 0 ? `受取 ${money(row.remaining)}` : row.remaining < 0 ? `支払 ${money(-row.remaining)}` : "± ￥0"}</td></tr>)}</tbody></table></div></div>
      {settlementData.unassignedPaid > 0 && <div className="settlement-warning"><strong>精算対象外の支払済みが {money(settlementData.unassignedPaid)} あります。</strong><span>支払者が未設定、または費用・精算の対象者から外れているため、候補に反映していません。</span></div>}
      {settlementData.incompleteExpenses.length > 0 && <div className="settlement-warning"><strong>精算に反映していない費用があります。</strong>{settlementData.incompleteExpenses.map((expense) => <span key={expense.id}>「{expense.title}」{money(expense.amount)}：{expense.reason}。編集して支払者・負担者・負担額を揃えてください。</span>)}</div>}
      <div className="finance-subheading"><div><h3>送金候補</h3><small className="finance-note-inline">候補を確認して、実際に送金したら記録します</small></div></div><div className="settlement-list">{settlementData.suggestions.map((suggestion) => <div className="settlement-row" key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}`}><span>{nameOf(suggestion.from)} → {nameOf(suggestion.to)}</span><b>{money(suggestion.amount)}</b><button className="save-button" onClick={() => void markSettlementPaid(suggestion)} disabled={saving}>支払済みにする</button></div>)}</div>{!settlementData.suggestions.length && <p className="empty-state">現在、精算候補はありません。</p>}
      <div className="settlement-history">{settlements.filter((item) => item.status === "paid" && settlementParticipantIds.includes(item.from_id) && settlementParticipantIds.includes(item.to_id)).map((settlement) => <span key={settlement.id}>{nameOf(settlement.from_id)} → {nameOf(settlement.to_id)} {money(settlement.amount)} 済</span>)}</div>
    </section>
    <TripTabs tripSlug={tripSlug} active="budget" />
  </main>;
}

function Summary({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={`summary-card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>; }
function BudgetMetric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <div className={`budget-planner-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
