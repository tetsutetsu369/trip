import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const root = document.querySelector("#app");
const config = window.TRIP_CONFIG;

if (!config) {
  root.textContent = "公開設定を読み込めませんでした。しばらくしてから再読み込みしてください。";
  throw new Error("Missing public configuration");
}

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function startLogin() {
  location.href = `${config.supabaseUrl}/functions/v1/line-login?next=/`;
}

async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}

async function setSessionFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return;
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
  history.replaceState({}, "", location.pathname);
}

function bindActions() {
  document.querySelector("#login")?.addEventListener("click", startLogin);
  document.querySelector("#logout")?.addEventListener("click", signOut);
}

function loginScreen() {
  root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>四国三郎の郷 BBQ旅</h1><p>参加者専用の旅行ポータルです。</p><div class="portal-hero-actions"><button class="portal-action primary" id="login">LINEでログイン</button></div></section></main>`;
  bindActions();
}

function pendingScreen(status) {
  const approved = status === "approved";
  root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>${approved ? "ログイン情報を更新してください" : "参加申請を確認中です"}</h1><p>${approved ? "権限は承認済みです。一度ログアウトして、LINEでログインし直してください。" : "管理者が承認すると、このページを利用できます。"}</p><div class="portal-hero-actions"><button class="portal-action primary" id="logout">ログアウトしてやり直す</button></div></section></main>`;
  bindActions();
}

async function render() {
  try {
    await setSessionFromHash();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return loginScreen();

    const { data: membership } = await supabase
      .from("trip_members")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    const { data: trip } = await supabase
      .from("trips")
      .select("id,name,description,start_date,end_date")
      .eq("slug", config.tripSlug)
      .maybeSingle();
    if (!trip) return pendingScreen(membership?.status);

    const [items, packing, notes, settings] = await Promise.all([
      supabase.from("itinerary_items").select("event_date,event_time,title,place,notes").eq("trip_id", trip.id).order("event_date").order("event_time"),
      supabase.from("packing_items").select("name,memo,is_ready").eq("trip_id", trip.id),
      supabase.from("shared_notes").select("title,body").eq("trip_id", trip.id).order("updated_at", { ascending: false }).limit(3),
      supabase.from("trip_settings").select("budget").eq("trip_id", trip.id).maybeSingle(),
    ]);
    const budget = settings.data?.budget;
    const total = budget ? Number(budget.cottage || 0) + Number(budget.adventure || 0) + Number(budget.purchasePerBudget || 0) * Number(budget.people || 1) : 0;
    const perPerson = Math.round(total / Math.max(1, Number(budget?.people || 1)));
    const itinerary = (items.data || []).map((item) => `<article class="trip-card"><div class="trip-date"><strong>${escapeHtml(item.event_time?.slice(0, 5) || "--:--")}</strong><span>${escapeHtml(item.event_date || "日程未定")}</span></div><div class="trip-copy"><span>${escapeHtml(item.place || "場所未定")}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.notes || "詳細はありません")}</p></div></article>`).join("") || `<div class="empty-state">予定はまだありません。</div>`;
    const packingList = (packing.data || []).map((item) => `<li><span class="check-mark">${item.is_ready ? "✓" : "○"}</span><span><strong>${escapeHtml(item.name)}</strong>${item.memo ? `<small>${escapeHtml(item.memo)}</small>` : ""}</span></li>`).join("") || `<li class="empty-state">持ち物はまだありません。</li>`;
    const notesList = (notes.data || []).map((note) => `<article class="note-card"><p>${escapeHtml(note.title)}</p><span>${escapeHtml(note.body)}</span></article>`).join("") || `<div class="empty-state">共有メモはまだありません。</div>`;
    root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(trip.description)}</p><div class="portal-meta"><span>${escapeHtml(trip.start_date)} 〜 ${escapeHtml(trip.end_date)}</span></div><div class="portal-hero-actions"><button class="portal-action" id="logout">ログアウト</button></div></section><section class="portal-section"><div class="section-heading"><div><p>ITINERARY</p><h2>旅程</h2></div><span>${(items.data || []).length} 件の予定</span></div><div class="itinerary-list">${itinerary}</div></section><section class="portal-section"><div class="portal-summary-grid"><article class="portal-summary-card budget"><p>現在の概算合計</p><strong>¥${total.toLocaleString()}</strong><small>1人あたり ¥${perPerson.toLocaleString()}</small></article><article class="portal-summary-card packing"><p>持ち物</p><strong>${(packing.data || []).filter((item) => item.is_ready).length}<small> / ${(packing.data || []).length} 準備済み</small></strong><ul>${packingList}</ul></article></div></section><section class="portal-section"><div class="section-heading"><div><p>SHARED NOTES</p><h2>共有メモ</h2></div></div><div class="notes-grid">${notesList}</div></section></main>`;
    bindActions();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<main class="portal-shell"><section class="portal-hero"><h1>読み込みに失敗しました</h1><p>通信状態を確認して、再読み込みしてください。</p><div class="portal-hero-actions"><button class="portal-action primary" id="logout">ログアウトしてやり直す</button></div></section></main>`;
    bindActions();
  }
}

render();
