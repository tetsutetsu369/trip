import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const root = document.querySelector("#shared-app");
const config = window.TRIP_CONFIG;
const basePath = "../..";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[char]);

function login() {
  const next = `${location.pathname}${location.hash}`;
  location.href = `${config.supabaseUrl}/functions/v1/line-login?next=${encodeURIComponent(next)}`;
}

async function render() {
  if (!config) {
    root.innerHTML = `<main class="detail-shell"><section class="detail-hero"><h1>公開設定を読み込めませんでした</h1><p>しばらくしてから再読み込みしてください。</p></section></main>`;
    return;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      root.innerHTML = `<main class="detail-shell"><section class="detail-hero"><p class="portal-kicker">TRIP DETAILS</p><h1>旅程の詳細</h1><p>詳細を表示するにはログインしてください。</p><button class="portal-action primary" id="login">LINEでログイン</button></section></main>`;
      document.querySelector("#login")?.addEventListener("click", login);
      return;
    }

    const { data: trip } = await supabase.from("trips").select("id,name,description,start_date,end_date").eq("slug", config.tripSlug).maybeSingle();
    if (!trip) throw new Error("Trip not found");
    const [items, packing, notes] = await Promise.all([
      supabase.from("itinerary_items").select("event_date,event_time,title,place,notes").eq("trip_id", trip.id).order("event_date").order("event_time"),
      supabase.from("packing_items").select("name,memo,is_ready").eq("trip_id", trip.id).order("created_at"),
      supabase.from("shared_notes").select("title,body").eq("trip_id", trip.id).order("updated_at", { ascending: false }),
    ]);
    if (items.error || packing.error || notes.error) throw new Error("Trip data could not be loaded");

    const itinerary = (items.data || []).map((item) => `<article class="detail-item"><div class="detail-time"><strong>${escapeHtml(item.event_time?.slice(0, 5) || "未定")}</strong><span>${escapeHtml(item.event_date || "日程未定")}</span></div><div><h3>${escapeHtml(item.title)}</h3>${item.place ? `<p class="detail-place">${escapeHtml(item.place)}</p>` : ""}${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}</div></article>`).join("") || `<p class="empty-state">予定はまだありません。</p>`;
    const packingList = (packing.data || []).map((item) => `<li><span class="check-mark">${item.is_ready ? "✓" : "○"}</span><span><strong>${escapeHtml(item.name)}</strong>${item.memo ? `<small>${escapeHtml(item.memo)}</small>` : ""}</span></li>`).join("") || `<li class="empty-state">持ち物はまだありません。</li>`;
    const notesList = (notes.data || []).map((note) => `<article class="note-card"><p>${escapeHtml(note.title)}</p><span>${escapeHtml(note.body)}</span></article>`).join("") || `<p class="empty-state">共有メモはまだありません。</p>`;

    root.innerHTML = `<main class="detail-shell"><a class="detail-back" href="${basePath}/">← ポータルへ戻る</a><section class="detail-hero"><p class="portal-kicker">TRIP DETAILS</p><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(trip.description || "旅の詳細情報")}</p><div class="portal-meta"><span>${escapeHtml(trip.start_date)} 〜 ${escapeHtml(trip.end_date)}</span></div></section><section id="itinerary" class="detail-section"><div class="section-heading"><div><p>ITINERARY</p><h2>旅程の詳細</h2></div><span>${(items.data || []).length} 件</span></div><div class="detail-list">${itinerary}</div></section><section id="packing" class="detail-section"><div class="section-heading"><div><p>PACKING</p><h2>持ち物</h2></div></div><ul class="detail-packing">${packingList}</ul></section><section id="notes" class="detail-section"><div class="section-heading"><div><p>SHARED NOTES</p><h2>共有メモ</h2></div></div><div class="notes-grid">${notesList}</div></section><p class="detail-footer"><a class="section-link" href="${basePath}/shikoku-saburo-bbq-2026/">費用の詳細を見る →</a></p></main>`;
  } catch (error) {
    console.error(error);
    root.innerHTML = `<main class="detail-shell"><section class="detail-hero"><h1>読み込みに失敗しました</h1><p>通信状態を確認して、再読み込みしてください。</p><a class="portal-action primary" href="${basePath}/">ポータルへ戻る</a></section></main>`;
  }
}

render();
