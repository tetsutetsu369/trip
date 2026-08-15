import type { SupabaseClient } from "@supabase/supabase-js";

export type Purchase = { id: string; bought: boolean; name: string; category: string; cost: number; note: string };
export type Plan = {
  people: number; gasPrice: number; efficiency: number; toll: number; parking: number;
  kilometers: number[]; cottage: number; adventure: number; purchasePerBudget: number;
  purchases: Purchase[]; rentOn: boolean[]; rentQty: number[];
};

export const rentals = [["テント", 1560], ["タープ", 510], ["キャンプテーブル", 510], ["キャンプチェア", 200], ["バーベキューコンロ", 410], ["ガス式コンロ", 410], ["キャンプライト", 100], ["炊事用具", 620], ["毛布", 200], ["電気延長コード", 100]] as const;
export const categories = ["食費", "備品", "消耗品", "その他"] as const;

const purchase = (id: string, name: string, category: string): Purchase => ({ id, bought: false, name, category, cost: 0, note: "" });

export const initialPlan: Plan = {
  people: 4, gasPrice: 175, efficiency: 18, toll: 4000, parking: 0,
  kilometers: [65, 65, 85, 3, 135], cottage: 12560, adventure: 16400, purchasePerBudget: 5500,
  purchases: [
    purchase("food-bbq", "BBQの食材", "食費"), purchase("food-breakfast", "朝食", "食費"),
    purchase("food-drinks", "飲み物・お菓子", "食費"), purchase("food-hirome", "ひろめ市場での食事", "食費"),
    purchase("supply-fire", "炭・着火剤", "消耗品"), purchase("supply-tableware", "紙皿・割り箸・ゴミ袋", "消耗品"),
  ],
  rentOn: rentals.map(() => false), rentQty: rentals.map(() => 1),
};

export const storageKey = (tripSlug: string) => `trip:${tripSlug}:budget:v1`;

export type SaveOutcome = { status: "saved"; version: number } | { status: "conflict" } | { status: "error" };

export async function readBudget(supabase: SupabaseClient, tripId: string) {
  const { data, error } = await supabase.from("trip_settings").select("budget,version").eq("trip_id", tripId).maybeSingle<{ budget: Partial<Plan>; version: number }>();
  if (error) return null;
  return { plan: data?.budget ? { ...initialPlan, ...data.budget } : null, version: data?.version ?? null };
}

// 読み込んだ version と一致する行だけを更新する。更新0件＝他の人が先に保存した。
export async function persistBudget(supabase: SupabaseClient, tripId: string, next: Plan, version: number | null): Promise<SaveOutcome> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { status: "error" };
  if (version === null) {
    const { data, error } = await supabase.from("trip_settings").insert({ trip_id: tripId, budget: next, updated_by: userData.user.id }).select("version").maybeSingle<{ version: number }>();
    if (error) return { status: error.code === "23505" ? "conflict" : "error" };
    return data ? { status: "saved", version: data.version } : { status: "error" };
  }
  const { data, error } = await supabase.from("trip_settings").update({ budget: next, updated_by: userData.user.id }).eq("trip_id", tripId).eq("version", version).select("version").maybeSingle<{ version: number }>();
  if (error) return { status: "error" };
  return data ? { status: "saved", version: data.version } : { status: "conflict" };
}
