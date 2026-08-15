"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Person = { id: string; name: string };
type Purchase = { id: string; name: string; category: string; planned_amount: number; purchased_amount: number; is_purchased: boolean; memo: string; version: number };
type ReceiptItem = { id: string; name: string; category: string; net_amount: number; tax_rate: number; tax_amount: number; gross_amount: number };
type Receipt = { id: string; store_name: string; purchased_on: string | null; payer_id: string | null; memo: string; items: ReceiptItem[] };
type Expense = { id: string; receipt_id: string | null; title: string; category: string; amount: number; payer_id: string | null; payment_status: string; settlement_status: string; memo: string; version: number };
type Share = { expense_id: string; user_id: string; amount: number };
type Settlement = { id: string; from_user_id: string; to_user_id: string; amount: number; status: string };
type DraftItem = { name: string; category: string; net_amount: number; tax_rate: number };

const money = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const categories = ["food", "equipment", "supplies", "lodging", "activity", "transport", "other"] as const;
const categoryLabel: Record<string, string> = { food: "食費", equipment: "備品", supplies: "消耗品", lodging: "宿泊", activity: "遊び", transport: "移動", receipt: "レシート", other: "その他" };

export default function FinancePage({ tripId, tripSlug, tripName, avatarUrl = null, userId }: { tripId: string; tripSlug: string; tripName: string; avatarUrl?: string | null; userId: string }) {
  const supabase = createBrowserSupabaseClient();
  const [people, setPeople] = useState<Person[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [purchaseDraft, setPurchaseDraft] = useState({ name: "", category: "food", planned_amount: 0, memo: "" });
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [receiptDraft, setReceiptDraft] = useState({ store_name: "", purchased_on: today(), payer_id: userId, memo: "" });
  const [items, setItems] = useState<DraftItem[]>([{ name: "", category: "food", net_amount: 0, tax_rate: 0.1 }]);
  const [status, setStatus] = useState("読み込み中…");
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? "未設定";
  const load = async (message = "みんなに共有済み") => {
    if (!supabase) { setStatus("Supabase未接続"); return; }
    const [purchaseResult, receiptResult, itemResult, expenseResult, shareResult, settlementResult, memberResult] = await Promise.all([
      supabase.from("purchases").select("id,name,category,planned_amount,purchased_amount,is_purchased,memo,version").eq("trip_id", tripId).order("created_at"),
      supabase.from("receipts").select("id,store_name,purchased_on,payer_id,memo").eq("trip_id", tripId).order("purchased_on", { ascending: false }),
      supabase.from("receipt_items").select("id,receipt_id,name,category,net_amount,tax_rate,tax_amount,gross_amount"),
      supabase.from("expenses").select("id,receipt_id,title,category,amount,payer_id,payment_status,settlement_status,memo,version").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("expense_shares").select("expense_id,user_id,amount"),
      supabase.from("settlements").select("id,from_user_id,to_user_id,amount,status").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("trip_members").select("user_id").eq("trip_id", tripId).eq("status", "approved"),
    ]);
    if (purchaseResult.error || receiptResult.error || itemResult.error || expenseResult.error || shareResult.error || settlementResult.error || memberResult.error) { setStatus("費用データを読み込めませんでした"); return; }
    const userIds = (memberResult.data ?? []).map((member) => member.user_id);
    const profileResult = userIds.length ? await supabase.from("profiles").select("id,nickname,line_display_name").in("id", userIds) : { data: [], error: null };
    if (profileResult.error) { setStatus("参加者を読み込めませんでした"); return; }
    setPeople((profileResult.data ?? []).map((profile) => ({ id: profile.id, name: profile.nickname || profile.line_display_name || "参加者" })));
    const itemMap = new Map<string, ReceiptItem[]>();
    for (const item of itemResult.data ?? []) itemMap.set(item.receipt_id, [...(itemMap.get(item.receipt_id) ?? []), item]);
    setPurchases(purchaseResult.data ?? []);
    setReceipts((receiptResult.data ?? []).map((receipt) => ({ ...receipt, items: itemMap.get(receipt.id) ?? [] })));
    setExpenses(expenseResult.data ?? []);
    setShares(shareResult.data ?? []);
    setSettlements(settlementResult.data ?? []);
    setStatus(message);
  };
  useEffect(() => { void load(); }, [tripId]);

  const totals = useMemo(() => ({
    planned: purchases.reduce((sum, purchase) => sum + purchase.planned_amount, 0),
    purchased: purchases.reduce((sum, purchase) => sum + (purchase.is_purchased ? purchase.purchased_amount : 0), 0),
    expenses: expenses.reduce((sum, expense) => sum + expense.amount, 0),
  }), [purchases, expenses]);

  const balances = useMemo(() => {
    const result = new Map<string, number>(people.map((person) => [person.id, 0]));
    for (const expense of expenses) {
      if (expense.payment_status !== "paid" || !expense.payer_id) continue;
      result.set(expense.payer_id, (result.get(expense.payer_id) ?? 0) + expense.amount);
      for (const share of shares.filter((item) => item.expense_id === expense.id)) result.set(share.user_id, (result.get(share.user_id) ?? 0) - share.amount);
    }
    for (const settlement of settlements.filter((item) => item.status === "paid")) {
      result.set(settlement.from_user_id, (result.get(settlement.from_user_id) ?? 0) + settlement.amount);
      result.set(settlement.to_user_id, (result.get(settlement.to_user_id) ?? 0) - settlement.amount);
    }
    return [...result.entries()].map(([id, amount]) => ({ id, amount })).filter((item) => Math.abs(item.amount) > 0);
  }, [expenses, people, shares, settlements]);

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

  const addPurchase = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !purchaseDraft.name.trim()) return; setSaving(true);
    const { error } = await supabase.from("purchases").insert({ trip_id: tripId, name: purchaseDraft.name.trim(), category: purchaseDraft.category, planned_amount: purchaseDraft.planned_amount, purchased_amount: 0, is_purchased: false, memo: purchaseDraft.memo.trim(), created_by: userId });
    setSaving(false); if (error) { setStatus("購入品を追加できませんでした"); return; }
    setPurchaseDraft({ name: "", category: "food", planned_amount: 0, memo: "" }); await load("購入品を追加しました");
  };
  const togglePurchase = async (purchase: Purchase) => {
    if (!supabase) return; setSaving(true);
    const { data, error } = await supabase.from("purchases").update({ is_purchased: !purchase.is_purchased, purchased_amount: !purchase.is_purchased ? purchase.planned_amount : 0 }).eq("id", purchase.id).eq("version", purchase.version).select("id").maybeSingle();
    setSaving(false); await load(data && !error ? "購入状態を更新しました" : "他の人が先に更新しました");
  };
  const removePurchase = async (purchase: Purchase) => {
    if (!supabase || !window.confirm(`「${purchase.name}」を削除しますか？`)) return; setSaving(true);
    const { error } = await supabase.from("purchases").delete().eq("id", purchase.id).eq("version", purchase.version); setSaving(false); await load(error ? "購入品を削除できませんでした" : "購入品を削除しました");
  };
  const savePurchaseEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !editingPurchase?.name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from("purchases").update({ name: editingPurchase.name.trim(), category: editingPurchase.category, planned_amount: Math.max(0, editingPurchase.planned_amount), memo: editingPurchase.memo.trim() }).eq("id", editingPurchase.id).eq("version", editingPurchase.version).select("id").maybeSingle();
    setSaving(false);
    if (error) { setStatus("購入品を保存できませんでした"); return; }
    setEditingPurchase(null);
    await load(data ? "購入品を更新しました" : "他の人が先に更新しました");
  };
  const submitReceipt = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !receiptDraft.store_name.trim() || !items.some((item) => item.name.trim() && item.net_amount > 0)) return; setSaving(true);
    const inputItems = items.filter((item) => item.name.trim() && item.net_amount > 0).map((item) => { const taxAmount = Math.floor(item.net_amount * item.tax_rate); return { name: item.name.trim(), category: item.category, net_amount: item.net_amount, tax_rate: item.tax_rate, tax_amount: taxAmount, gross_amount: item.net_amount + taxAmount }; });
    const shareIds = people.map((person) => person.id);
    const { data, error } = await supabase.rpc("create_receipt_expense", { target_trip_id: tripId, input_store_name: receiptDraft.store_name.trim(), input_purchased_on: receiptDraft.purchased_on || null, input_payer_id: receiptDraft.payer_id || null, input_memo: receiptDraft.memo.trim(), input_items: inputItems, input_share_user_ids: shareIds });
    setSaving(false);
    if (error || data?.status !== "ok") { setStatus(data?.status === "forbidden" ? "権限がありません" : "レシートを保存できませんでした"); return; }
    setReceiptDraft({ store_name: "", purchased_on: today(), payer_id: userId, memo: "" }); setItems([{ name: "", category: "food", net_amount: 0, tax_rate: 0.1 }]); await load("レシートと費用を保存しました");
  };
  const markSettlementPaid = async (suggestion: { from: string; to: string; amount: number }) => {
    if (!supabase) return; setSaving(true);
    const { error } = await supabase.from("settlements").insert({ trip_id: tripId, from_user_id: suggestion.from, to_user_id: suggestion.to, amount: suggestion.amount, status: "paid", created_by: userId }); setSaving(false); await load(error ? "精算記録を保存できませんでした" : "精算済みとして記録しました");
  };
  const addItem = () => setItems([...items, { name: "", category: "food", net_amount: 0, tax_rate: 0.1 }]);

  return <main className="budget-shell finance-shell"><TripHeader tripSlug={tripSlug} tripName={tripName} avatarUrl={avatarUrl} /><p className="save-status" role="status">{status}</p>
    <section className="budget-hero"><p className="kicker">COST & SETTLEMENT</p><h1>費用と精算</h1><p>{tripName}</p></section>
    <section className="summary-grid finance-summary"><Summary label="購入予定" value={totals.planned} /><Summary label="購入済み" value={totals.purchased} tone="paid" /><Summary label="立替費用" value={totals.expenses} /><Summary label="精算候補" value={suggestions.reduce((sum, item) => sum + item.amount, 0)} tone="due" /></section>

    <h2 className="budget-title">買い物リスト</h2>
    <section className="panel finance-panel"><form className="finance-inline-form" onSubmit={addPurchase}><input required placeholder="購入するもの" value={purchaseDraft.name} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, name: event.target.value })} /><select value={purchaseDraft.category} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select><input type="number" min="0" placeholder="予定額" value={purchaseDraft.planned_amount || ""} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, planned_amount: Math.max(0, Number(event.target.value) || 0) })} /><button className="save-button" disabled={saving}>追加</button></form><div className="finance-list">{purchases.map((purchase) => editingPurchase?.id === purchase.id ? <form className="purchase-edit-form" key={purchase.id} onSubmit={savePurchaseEdit}><input aria-label="購入品名" required value={editingPurchase.name} onChange={(event) => setEditingPurchase({ ...editingPurchase, name: event.target.value })} /><select aria-label="カテゴリ" value={editingPurchase.category} onChange={(event) => setEditingPurchase({ ...editingPurchase, category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select><input aria-label="予定額" type="number" min="0" value={editingPurchase.planned_amount} onChange={(event) => setEditingPurchase({ ...editingPurchase, planned_amount: Math.max(0, Number(event.target.value) || 0) })} /><input aria-label="メモ" value={editingPurchase.memo} onChange={(event) => setEditingPurchase({ ...editingPurchase, memo: event.target.value })} /><div className="purchase-edit-actions"><button className="save-button" disabled={saving}>保存</button><button type="button" className="text-button" onClick={() => setEditingPurchase(null)} disabled={saving}>キャンセル</button></div></form> : <div className="finance-row" key={purchase.id}><input type="checkbox" checked={purchase.is_purchased} onChange={() => void togglePurchase(purchase)} disabled={saving} /><div><strong>{purchase.name || "名称未設定"}</strong><small>{categoryLabel[purchase.category] ?? purchase.category}｜{purchase.memo || "メモなし"}</small></div><b>{money(purchase.is_purchased ? purchase.purchased_amount : purchase.planned_amount)}</b><button className="text-button" onClick={() => setEditingPurchase(purchase)} disabled={saving}>編集</button><button className="text-button danger" onClick={() => void removePurchase(purchase)} disabled={saving}>削除</button></div>)}</div>{!purchases.length && <p className="empty-state">購入品はまだありません。</p>}</section>

    <h2 className="budget-title">レシートを登録</h2>
    <section className="panel finance-panel"><form className="finance-form" onSubmit={submitReceipt}><div className="fields"><label className="field"><span>店名</span><input required value={receiptDraft.store_name} onChange={(event) => setReceiptDraft({ ...receiptDraft, store_name: event.target.value })} /></label><label className="field"><span>購入日</span><input type="date" value={receiptDraft.purchased_on} onChange={(event) => setReceiptDraft({ ...receiptDraft, purchased_on: event.target.value })} /></label><label className="field"><span>立替えた人</span><select value={receiptDraft.payer_id} onChange={(event) => setReceiptDraft({ ...receiptDraft, payer_id: event.target.value })}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="field"><span>メモ</span><input value={receiptDraft.memo} onChange={(event) => setReceiptDraft({ ...receiptDraft, memo: event.target.value })} /></label></div><div className="finance-items"><div className="finance-subheading"><h3>明細</h3><button type="button" className="text-button" onClick={addItem}>＋ 明細を追加</button></div>{items.map((item, index) => <div className="finance-item" key={index}><input required placeholder="品目" value={item.name} onChange={(event) => setItems(items.map((current, itemIndex) => itemIndex === index ? { ...current, name: event.target.value } : current))} /><select value={item.category} onChange={(event) => setItems(items.map((current, itemIndex) => itemIndex === index ? { ...current, category: event.target.value } : current))}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select><input required type="number" min="0" placeholder="税抜" value={item.net_amount || ""} onChange={(event) => setItems(items.map((current, itemIndex) => itemIndex === index ? { ...current, net_amount: Math.max(0, Number(event.target.value) || 0) } : current))} /><select value={item.tax_rate} onChange={(event) => setItems(items.map((current, itemIndex) => itemIndex === index ? { ...current, tax_rate: Number(event.target.value) } : current))}><option value="0.1">10%</option><option value="0.08">8%</option><option value="0">非課税</option></select></div>)}</div><p className="finance-note">登録時に税込額を計算し、承認済み参加者全員へ均等に負担額を作成します。</p><button className="save-button" disabled={saving}>レシートと費用を保存</button></form></section>

    <h2 className="budget-title">立替費用</h2>
    <section className="panel finance-panel"><div className="finance-list">{expenses.map((expense) => <div className="finance-expense" key={expense.id}><div><strong>{expense.title}</strong><span>{categoryLabel[expense.category] ?? expense.category}｜立替え：{nameOf(expense.payer_id)}</span></div><b>{money(expense.amount)}</b><small>{expense.settlement_status === "settled" ? "精算済み" : "未精算"}</small></div>)}</div>{!expenses.length && <p className="empty-state">立替費用はまだありません。</p>}</section>

    <h2 className="budget-title">精算</h2>
    <section className="panel finance-panel"><p className="finance-note">立替えた金額と各人の負担額から、支払い先を自動計算しています。</p><div className="settlement-list">{suggestions.map((suggestion) => <div className="settlement-row" key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}`}><span>{nameOf(suggestion.from)} → {nameOf(suggestion.to)}</span><b>{money(suggestion.amount)}</b><button className="save-button" onClick={() => void markSettlementPaid(suggestion)} disabled={saving}>支払済みにする</button></div>)}</div>{!suggestions.length && <p className="empty-state">現在、精算候補はありません。</p>}<div className="settlement-history">{settlements.filter((item) => item.status === "paid").map((settlement) => <span key={settlement.id}>{nameOf(settlement.from_user_id)} → {nameOf(settlement.to_user_id)} {money(settlement.amount)} 済</span>)}</div></section>
    <TripTabs tripSlug={tripSlug} active="budget" />
  </main>;
}

function Summary({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={`summary-card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>; }
