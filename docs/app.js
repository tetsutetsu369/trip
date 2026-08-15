import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const root = document.querySelector("#app");
const config = window.TRIP_CONFIG;
const base = ".";
const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const link = (path) => `${base}/shikoku-saburo-bbq-2026/${path}`;

if (!config) { root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><h1>公開設定を読み込めませんでした</h1><p>しばらく待ってから再読み込みしてください。</p></section></main>`; throw new Error("Missing public configuration"); }
const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
const login = () => { location.href = `${config.supabaseUrl}/functions/v1/line-login?next=${encodeURIComponent(location.pathname)}`; };
const logout = async () => { await supabase.auth.signOut(); location.reload(); };
const header = (role = "member") => `<header class="trip-header"><a class="trip-header-brand" href="${base}/"><span class="trip-header-mark">TJ</span><span><strong>Trip Journal</strong><small>四国三郎の郷 BBQ旅</small></span></a><nav class="trip-header-nav"><a class="is-active" href="${base}/">ポータル</a><a href="${link("itinerary/")}">旅程</a><a href="${link("budget/")}">費用計算</a><a href="${link("packing/")}">持ち物</a><a href="${link("notes/")}">メモ</a><a href="${link("profile/")}">プロフィール</a>${role === "admin" ? `<a class="admin-link" href="${link("admin/")}">管理者</a>` : ""}</nav></header>`;

async function render() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>四国三郎の郷 BBQ旅</h1><p>旅程、費用、持ち物、メモを一つにまとめた共有ポータルです。</p><div class="portal-hero-actions"><button class="portal-action primary" id="login">LINEでログイン</button></div></section></main>`; document.querySelector("#login").onclick = login; return; }
  const { data: trip } = await supabase.from("trips").select("id,name,description,start_date,end_date").eq("slug", config.tripSlug).maybeSingle();
  if (!trip) { root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><h1>参加承認を確認中です</h1><p>管理者の承認後、この旅のポータルを利用できます。</p><button class="portal-action" id="logout">ログアウト</button></section></main>`; document.querySelector("#logout").onclick = logout; return; }
  const { data: membership } = await supabase.from("trip_members").select("status,role").eq("trip_id", trip.id).eq("user_id", user.id).maybeSingle();
  if (membership?.status !== "approved") { root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><h1>参加承認を確認中です</h1><p>管理者の承認が完了すると、旅のデータを表示できます。</p><button class="portal-action" id="logout">ログアウト</button></section></main>`; document.querySelector("#logout").onclick = logout; return; }
  const [items, packing, notes, settings] = await Promise.all([
    supabase.from("itinerary_items").select("event_date,event_time,title,place,notes").eq("trip_id", trip.id).order("event_date").order("event_time"),
    supabase.from("packing_items").select("name,memo,is_ready").eq("trip_id", trip.id).order("created_at"),
    supabase.from("shared_notes").select("title,body").eq("trip_id", trip.id).order("updated_at", { ascending: false }).limit(1),
    supabase.from("trip_settings").select("budget").eq("trip_id", trip.id).maybeSingle(),
  ]);
  const budget = settings.data?.budget || {}; const total = Number(budget.cottage || 0) + Number(budget.adventure || 0) + Number(budget.purchasePerBudget || 0) * Number(budget.people || 1); const perPerson = Math.round(total / Math.max(1, Number(budget.people || 1)));
  const itinerary = (items.data || []).slice(0, 4).map((item) => `<article class="trip-card"><div class="trip-date"><strong>${esc(item.event_time?.slice(0, 5) || "未定")}</strong><span>${esc(item.event_date || "")}</span></div><div class="trip-copy"><span>${esc(item.place || "場所未定")}</span><h3>${esc(item.title)}</h3><p>${esc(item.notes || "")}</p></div></article>`).join("") || `<div class="empty-state">まだ予定はありません。</div>`;
  const packingList = (packing.data || []).slice(0, 5).map((item) => `<li><span class="check-mark">${item.is_ready ? "✓" : "○"}</span><span><strong>${esc(item.name)}</strong>${item.memo ? `<small>${esc(item.memo)}</small>` : ""}</span></li>`).join("") || `<li class="empty-state">まだ持ち物はありません。</li>`;
  const note = notes.data?.[0];
  root.innerHTML = `<main class="portal-shell">${header(membership.role)}<section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>${esc(trip.name)}</h1><p>${esc(trip.description || "旅の共有ポータル")}</p><div class="portal-meta"><span>${esc(trip.start_date)} — ${esc(trip.end_date)}</span></div><div class="portal-hero-actions"><a class="portal-action primary" href="${link("itinerary/")}">旅程を見る</a><button class="portal-action" id="logout">ログアウト</button></div></section><section class="portal-section"><div class="section-heading"><div><p>ITINERARY</p><h2>旅程</h2></div><a class="section-link" href="${link("itinerary/")}">独立画面へ →</a></div><div class="itinerary-list">${itinerary}</div></section><section class="portal-section"><div class="portal-summary-grid"><article class="portal-summary-card budget"><p>費用計算</p><strong>¥${total.toLocaleString()}</strong><small>1人あたり ¥${perPerson.toLocaleString()}</small><a class="summary-link" href="${link("budget/")}">費用画面へ →</a></article><article class="portal-summary-card packing"><p>持ち物</p><strong>${(packing.data || []).filter((item) => item.is_ready).length}<small> / ${(packing.data || []).length} 準備済み</small></strong><ul>${packingList}</ul><a class="summary-link" href="${link("packing/")}">持ち物画面へ →</a></article></div></section><section class="portal-section"><div class="section-heading"><div><p>SHARED NOTES</p><h2>共有メモ</h2></div><a class="section-link" href="${link("notes/")}">独立画面へ →</a></div><div class="notes-grid">${note ? `<article class="note-card"><p>${esc(note.title)}</p><span>${esc(note.body || "")}</span></article>` : `<div class="empty-state">まだ共有メモはありません。</div>`}</div></section></main>`;
  document.querySelector("#logout").onclick = logout;
}

render().catch((error) => { console.error(error); root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><h1>読み込みに失敗しました</h1><p>通信状態を確認して、もう一度お試しください。</p></section></main>`; });
