"use client";

import { type FormEvent, useState } from "react";

export type BudgetPerson = { id: string; name: string; profile_id: string | null };
export type AllocationMethod = "equal_all" | "equal_selected" | "custom" | "personal";
export type ExpenseRecord = {
  id: string;
  transaction_id: string;
  merchant_name: string;
  purchased_on: string | null;
  itinerary_item_id: string | null;
  title: string;
  category: string;
  net_amount: number;
  tax_rate: number;
  tax_amount: number;
  planned_amount: number;
  amount: number;
  payer_id: string | null;
  payment_status: "unpaid" | "paid" | string;
  settlement_status: string;
  allocation_method: AllocationMethod;
  memo: string;
  version: number;
};
export type ExpenseShare = { expense_id: string; participant_id: string; amount: number };
export type Itinerary = {
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
export type DraftItem = { id?: string; name: string; category: string; net_amount: number; tax_rate: number; planned_amount: number; actual_amount: number };
export type ExpenseDraft = {
  id: string | null;
  version: number | null;
  transaction_id: string | null;
  merchant_name: string;
  purchased_on: string;
  itinerary_item_id: string;
  payment_status: "unpaid" | "paid";
  payer_id: string;
  allocation_method: AllocationMethod;
  share_user_ids: string[];
  share_amounts: Record<string, number>;
  memo: string;
  items: DraftItem[];
};
export type ExpenseItemInput = {
  title: string;
  category: string;
  planned_amount: number;
  actual_amount: number;
  net_amount: number;
  tax_rate: number;
  share_amounts: Record<string, number>;
  memo: string;
};
export type ExpenseSavePayload = {
  id: string | null;
  version: number | null;
  transaction_id: string | null;
  merchant_name: string;
  purchased_on: string | null;
  itinerary_item_id: string | null;
  payment_status: "unpaid" | "paid";
  payer_id: string | null;
  allocation_method: AllocationMethod;
  selected_ids: string[];
  items: ExpenseItemInput[];
  memo: string;
};
export type ExpenseSaveResult = { ok: boolean; message?: string };

export const categories = ["food", "equipment", "supplies", "lodging", "activity", "transport", "other"] as const;
export const categoryLabel: Record<string, string> = { food: "食費", equipment: "備品", supplies: "消耗品", lodging: "宿泊", activity: "遊び", transport: "移動", other: "その他" };
export const allocationLabel: Record<AllocationMethod, string> = { equal_all: "対象者全員で均等", equal_selected: "選択した人で均等", custom: "負担額を指定", personal: "個人負担" };
export const money = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value || 0);
export const amountOf = (value: unknown) => { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0; };
export const decimalOf = (value: unknown) => { const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? Math.max(0, number) : 0; };
export const taxAmountOf = (netAmount: number, taxRate: number) => Math.floor(amountOf(netAmount) * taxRate);
export const grossAmountOf = (item: Pick<DraftItem, "net_amount" | "tax_rate">) => amountOf(item.net_amount) + taxAmountOf(item.net_amount, decimalOf(item.tax_rate));
const today = () => new Date().toISOString().slice(0, 10);
const draftItemAmount = (item: DraftItem, paymentStatus: "unpaid" | "paid") => paymentStatus === "paid" ? amountOf(item.actual_amount || grossAmountOf(item)) : amountOf(item.planned_amount || grossAmountOf(item));
const splitEvenly = (total: number, ids: string[]) => {
  const safeIds = [...new Set(ids)];
  if (!safeIds.length) return {} as Record<string, number>;
  const base = Math.floor(Math.max(0, total) / safeIds.length);
  const remainder = Math.max(0, total) % safeIds.length;
  return Object.fromEntries(safeIds.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
};
const allocateGroupShares = (itemTotals: number[], participantIds: string[], participantTotals: Record<string, number>) => {
  const result = itemTotals.map(() => Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>);
  let itemIndex = 0;
  let itemRemaining = itemTotals[0] ?? 0;
  for (const participantId of participantIds) {
    let participantRemaining = amountOf(participantTotals[participantId]);
    while (participantRemaining > 0 && itemIndex < itemTotals.length) {
      if (itemRemaining <= 0) { itemIndex += 1; itemRemaining = itemTotals[itemIndex] ?? 0; continue; }
      const allocated = Math.min(participantRemaining, itemRemaining);
      result[itemIndex][participantId] = (result[itemIndex][participantId] ?? 0) + allocated;
      participantRemaining -= allocated;
      itemRemaining -= allocated;
    }
  }
  return result;
};

export const createNewExpenseDraft = (people: BudgetPerson[]): ExpenseDraft => ({
  id: null,
  version: null,
  transaction_id: null,
  merchant_name: "",
  purchased_on: today(),
  itinerary_item_id: "",
  payment_status: "unpaid",
  payer_id: "",
  allocation_method: "equal_selected",
  share_user_ids: people.map((person) => person.id),
  share_amounts: splitEvenly(0, people.map((person) => person.id)),
  memo: "",
  items: [{ name: "", category: "food", net_amount: 0, tax_rate: 0.1, planned_amount: 0, actual_amount: 0 }],
});

export const createExpenseDraft = (expense: ExpenseRecord, shares: ExpenseShare[], people: BudgetPerson[]): ExpenseDraft => {
  const expenseShares = shares.filter((share) => share.expense_id === expense.id);
  const fallbackNet = expense.payment_status === "paid" ? expense.amount : expense.planned_amount;
  return {
    id: expense.id,
    version: expense.version,
    transaction_id: expense.transaction_id,
    merchant_name: expense.merchant_name,
    purchased_on: expense.purchased_on ?? "",
    itinerary_item_id: expense.itinerary_item_id ?? "",
    payment_status: expense.payment_status === "paid" ? "paid" : "unpaid",
    payer_id: expense.payer_id ?? "",
    allocation_method: expense.allocation_method,
    share_user_ids: expenseShares.length ? expenseShares.map((share) => share.participant_id) : people.map((person) => person.id),
    share_amounts: Object.fromEntries(expenseShares.map((share) => [share.participant_id, share.amount])),
    memo: expense.memo,
    items: [{ id: expense.id, name: expense.title, category: expense.category, net_amount: expense.net_amount || fallbackNet, tax_rate: Number(expense.tax_rate || 0), planned_amount: expense.planned_amount, actual_amount: expense.amount }],
  };
};

export default function ExpenseEditor({
  initialDraft,
  people,
  itinerary,
  saving,
  onSave,
  onCancel,
}: {
  initialDraft: ExpenseDraft;
  people: BudgetPerson[];
  itinerary: Itinerary[];
  saving: boolean;
  onSave: (payload: ExpenseSavePayload) => Promise<ExpenseSaveResult>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [formError, setFormError] = useState("");
  const itineraryLabel = (item: Itinerary) => {
    const route = [item.travel_origin, item.travel_destination].filter(Boolean).join(" → ");
    return route || [item.event_date?.replaceAll("-", "/"), item.event_time?.slice(0, 5), item.title, item.place].filter(Boolean).join("｜");
  };
  const updateDraftItem = (index: number, patch: Partial<DraftItem>) => setDraft((current) => {
    const nextItems = current.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const nextItem = { ...item, ...patch };
      if (patch.net_amount !== undefined || patch.tax_rate !== undefined) {
        const gross = grossAmountOf(nextItem);
        nextItem.planned_amount = current.payment_status === "unpaid" ? gross : nextItem.planned_amount || gross;
        nextItem.actual_amount = current.payment_status === "paid" ? gross : 0;
      }
      return nextItem;
    });
    return { ...current, items: nextItems };
  });
  const changePaymentStatus = (paymentStatus: "unpaid" | "paid") => setDraft((current) => ({
    ...current,
    payment_status: paymentStatus,
    payer_id: paymentStatus === "paid" ? current.payer_id : "",
    allocation_method: paymentStatus === "unpaid" && current.allocation_method === "personal" ? "equal_selected" : current.allocation_method,
    items: current.items.map((item) => {
      const gross = grossAmountOf(item);
      return { ...item, planned_amount: item.planned_amount || gross, actual_amount: paymentStatus === "paid" ? item.actual_amount || gross : 0 };
    }),
  }));
  const toggleExpenseShare = (id: string) => setDraft((current) => ({ ...current, share_user_ids: current.share_user_ids.includes(id) ? current.share_user_ids.filter((value) => value !== id) : [...current.share_user_ids, id] }));
  const updateExpenseShareAmount = (id: string, value: string) => setDraft((current) => ({ ...current, share_amounts: { ...current.share_amounts, [id]: amountOf(value) } }));
  const removeDraftItem = (index: number) => setDraft((current) => current.items.length > 1 ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current);
  const draftTotals = draft.items.reduce((summary, item) => {
    const gross = draftItemAmount(item, draft.payment_status);
    return { net: summary.net + amountOf(item.net_amount), tax: summary.tax + taxAmountOf(item.net_amount, decimalOf(item.tax_rate)), gross: summary.gross + gross };
  }, { net: 0, tax: 0, gross: 0 });
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    const validItems = draft.items.filter((item) => item.name.trim() && draftItemAmount(item, draft.payment_status) > 0);
    if (validItems.length !== draft.items.length) { setFormError("明細名と金額をすべて入力してください"); return; }
    if (draft.payment_status === "paid" && (!draft.payer_id || !people.some((person) => person.id === draft.payer_id))) { setFormError("支払済みの場合は支払者を選択してください"); return; }
    const peopleIds = people.map((person) => person.id);
    const selectedIds = draft.allocation_method === "equal_all"
      ? peopleIds
      : draft.allocation_method === "personal"
        ? (draft.payer_id ? [draft.payer_id] : [])
        : draft.allocation_method === "custom"
          ? peopleIds.filter((id) => Object.prototype.hasOwnProperty.call(draft.share_amounts, id) && amountOf(draft.share_amounts[id]) > 0)
          : draft.share_user_ids.filter((id) => peopleIds.includes(id));
    const itemTotals = validItems.map((item) => draftItemAmount(item, draft.payment_status));
    const total = itemTotals.reduce((sum, amount) => sum + amount, 0);
    if (!selectedIds.length) { setFormError("負担者を1人以上選択してください"); return; }
    const shareTotals = draft.allocation_method === "custom"
      ? Object.fromEntries(selectedIds.map((id) => [id, amountOf(draft.share_amounts[id])]))
      : draft.allocation_method === "personal"
        ? { [draft.payer_id]: total }
        : splitEvenly(total, selectedIds);
    if (Object.values(shareTotals).reduce((sum, amount) => sum + amount, 0) !== total) { setFormError("負担額の合計を" + money(total) + "にしてください"); return; }
    const itemShares = allocateGroupShares(itemTotals, selectedIds, shareTotals);
    const items = validItems.map((item, index) => {
      const gross = itemTotals[index];
      return {
        title: item.name.trim(),
        category: item.category,
        planned_amount: draft.payment_status === "unpaid" ? gross : amountOf(item.planned_amount || gross),
        actual_amount: draft.payment_status === "paid" ? gross : 0,
        net_amount: amountOf(item.net_amount),
        tax_rate: decimalOf(item.tax_rate),
        share_amounts: itemShares[index],
        memo: draft.memo.trim(),
      };
    });
    const result = await onSave({
      id: draft.id,
      version: draft.version,
      transaction_id: draft.transaction_id,
      merchant_name: draft.merchant_name.trim(),
      purchased_on: draft.purchased_on || null,
      itinerary_item_id: draft.itinerary_item_id || null,
      payment_status: draft.payment_status,
      payer_id: draft.payment_status === "paid" ? draft.payer_id : null,
      allocation_method: draft.allocation_method === "equal_all" ? "equal_selected" : draft.allocation_method,
      selected_ids: selectedIds,
      items,
      memo: draft.memo.trim(),
    });
    if (!result.ok) setFormError(result.message ?? "費用を保存できませんでした");
  };

  return <form className="expense-form expense-editor-form" onSubmit={handleSubmit}>
    <div className="expense-editor-heading">
      <div><h3>{draft.id ? "登録済みの費用を編集" : "費用を追加"}</h3><p>支払い前は予定、支払済みは実績と精算へ反映します。明細は1行ごとに別の費用になります。</p></div>
      {draft.id && <span className="expense-editing-badge">一覧から展開中</span>}
    </div>
    <div className="fields expense-form-fields">
      <label className="field"><span>支払先・店名</span><input value={draft.merchant_name} onChange={(event) => setDraft({ ...draft, merchant_name: event.target.value })} placeholder="例：道の駅・高速道路" /></label>
      <label className="field"><span>利用日</span><input type="date" value={draft.purchased_on} onChange={(event) => setDraft({ ...draft, purchased_on: event.target.value })} /></label>
      <label className="field"><span>状態</span><select value={draft.payment_status} onChange={(event) => changePaymentStatus(event.target.value as "unpaid" | "paid")}><option value="unpaid">支払い前・予定</option><option value="paid">支払済み</option></select></label>
      <label className="field"><span>支払者</span><select value={draft.payer_id} disabled={draft.payment_status !== "paid"} onChange={(event) => setDraft({ ...draft, payer_id: event.target.value })}><option value="">未設定（支払い前）</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{draft.payment_status === "paid" && !draft.payer_id && <small className="field-hint">支払済みにするには必須です</small>}</label>
      <label className="field"><span>関連する行程</span><select value={draft.itinerary_item_id} onChange={(event) => setDraft({ ...draft, itinerary_item_id: event.target.value })}><option value="">行程に紐づけない</option>{itinerary.map((item) => <option key={item.id} value={item.id}>{itineraryLabel(item)}</option>)}</select></label>
      <label className="field"><span>メモ</span><input value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} placeholder="用途・区間など" /></label>
    </div>
    <div className="finance-items">
      <div className="finance-subheading"><div><h3>明細</h3><small className="finance-note-inline">品目ごとに税率を設定できます</small></div><button type="button" className="text-button" onClick={() => setDraft({ ...draft, items: [...draft.items, { name: "", category: "food", net_amount: 0, tax_rate: 0.1, planned_amount: 0, actual_amount: 0 }] })} disabled={saving}>＋ 明細を追加</button></div>
      {draft.items.map((item, index) => <div className="finance-item expense-line" key={item.id ?? index}>
        <label><span>品目・用途</span><input required placeholder="例：食材・備品" value={item.name} onChange={(event) => updateDraftItem(index, { name: event.target.value })} /></label>
        <label><span>分類</span><select value={item.category} onChange={(event) => updateDraftItem(index, { category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select></label>
        <label><span>税抜金額</span><input required type="number" min="0" step="1" placeholder="0" value={item.net_amount || ""} onChange={(event) => updateDraftItem(index, { net_amount: amountOf(event.target.value) })} /></label>
        <label><span>税率</span><select value={String(item.tax_rate)} onChange={(event) => updateDraftItem(index, { tax_rate: Number(event.target.value) })}><option value="0.1">10%</option><option value="0.08">8%</option><option value="0">非課税</option></select></label>
        <span className="expense-item-total">税込 {money(grossAmountOf(item))}</span>
        {draft.items.length > 1 && <button type="button" className="text-button danger" onClick={() => removeDraftItem(index)} disabled={saving}>削除</button>}
      </div>)}
    </div>
    <div className="expense-items-total"><span>登録額（税込）</span><strong>{money(draftTotals.gross)}</strong><small>税抜 {money(draftTotals.net)}＋税 {money(draftTotals.tax)}</small></div>
    <fieldset className="expense-allocation">
      <legend>{draft.payment_status === "paid" ? "負担者" : "負担予定者"}</legend>
      <p className="finance-note">{draft.payment_status === "paid" ? "この支払済み費用を誰が負担するか確認・変更してください。" : "支払い前でも負担予定は決めておけます。支払者は支払済みにした時点で設定します。"}</p>
      <div className="allocation-options">{(Object.keys(allocationLabel) as AllocationMethod[]).map((method) => <label key={method}><input type="radio" name={"expense-allocation-" + (draft.id ?? "new")} checked={draft.allocation_method === method} disabled={draft.payment_status !== "paid" && method === "personal"} onChange={() => setDraft({ ...draft, allocation_method: method })} />{allocationLabel[method]}</label>)}</div>
      {draft.allocation_method === "equal_all" && <p className="finance-note">費用・予算・精算の対象者全員で均等に負担します。</p>}
      {draft.allocation_method === "equal_selected" && <div className="participant-options">{people.map((person) => <label key={person.id}><input type="checkbox" checked={draft.share_user_ids.includes(person.id)} onChange={() => toggleExpenseShare(person.id)} /><span>{person.name}</span></label>)}</div>}
      {draft.allocation_method === "custom" && <div className="custom-share-list">{people.map((person) => <label key={person.id}><span>{person.name}</span><input type="number" min="0" step="1" value={draft.share_amounts[person.id] ?? ""} placeholder="0" onChange={(event) => updateExpenseShareAmount(person.id, event.target.value)} /></label>)}</div>}
      {draft.allocation_method === "personal" && <p className="finance-note">支払者本人の個人負担として登録します。支払済みの場合だけ選択できます。</p>}
    </fieldset>
    {formError && <p className="expense-form-error" role="alert">{formError}</p>}
    <div className="inline-actions"><button type="submit" className="save-button" disabled={saving}>{saving ? "保存中…" : "費用を保存"}</button><button type="button" onClick={onCancel} disabled={saving}>キャンセル</button></div>
  </form>;
}
