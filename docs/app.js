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
  root.innerHTML = `<section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>四国三郎の郷 BBQ旅</h1><p>参加者専用の旅行ポータルです。</p><button id="login">LINEでログイン</button></section>`;
  bindActions();
}

function pendingScreen(status) {
  const approved = status === "approved";
  root.innerHTML = `<section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>${approved ? "ログイン情報を更新してください" : "参加申請を確認中です"}</h1><p>${approved ? "権限は承認済みです。一度ログアウトして、LINEでログインし直してください。" : "管理者が承認すると、このページを利用できます。"}</p><button id="logout">ログアウトしてやり直す</button></section>`;
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
    root.innerHTML = `<section class="portal-hero"><p class="portal-kicker">TRIP PORTAL</p><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(trip.description)}</p><small>${escapeHtml(trip.start_date)} 〜 ${escapeHtml(trip.end_date)}</small><button id="logout">ログアウト</button></section><section class="portal-section"><h2>旅程</h2>${(items.data || []).map((item) => `<article class="trip-card"><b>${escapeHtml(item.event_time?.slice(0, 5) || "未定")}</b><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.place)} ${escapeHtml(item.notes)}</p></div></article>`).join("") || "予定はまだありません。"}</section><section class="portal-section"><h2>持ち物</h2>${(packing.data || []).map((item) => `<p>${item.is_ready ? "✓" : "○"} ${escapeHtml(item.name)} ${escapeHtml(item.memo)}</p>`).join("") || "持ち物はまだありません。"}</section><section class="portal-section"><h2>予算</h2><p>現在の概算合計: <strong>¥${total.toLocaleString()}</strong></p><p>1人あたり: <strong>¥${perPerson.toLocaleString()}</strong></p></section><section class="portal-section"><h2>共有メモ</h2>${(notes.data || []).map((note) => `<article><h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.body)}</p></article>`).join("") || "メモはまだありません。"}</section>`;
    bindActions();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<section class="portal-hero"><h1>読み込みに失敗しました</h1><p>通信状態を確認して、再読み込みしてください。</p><button id="logout">ログアウトしてやり直す</button></section>`;
    bindActions();
  }
}

render();
