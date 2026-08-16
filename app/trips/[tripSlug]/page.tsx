import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { getTripSiteConfig } from "@/lib/trips/site-config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTripIdBySlug } from "@/lib/trips/membership";
import TripHeader from "@/app/components/TripHeader";
import TripTabs from "@/app/components/TripTabs";

type ItineraryPreview = { event_date: string | null; event_time: string | null; title: string; place: string; place_id: string | null };
type PlacePreview = { id: string; name: string; map_url: string };
type PackingPreview = { name: string; is_ready: boolean };
type NotePreview = { title: string; body: string };
type PurchasePreview = { planned_amount: number; purchased_amount: number; is_purchased: boolean };
type ExpensePreview = { amount: number; payment_status: string; settlement_status: string };
type TravelPreview = { travel_estimated_cost: number };

export default async function TripPortalPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const site = getTripSiteConfig(tripSlug);
  if (!site) notFound();

  let preview: { itinerary: ItineraryPreview[]; places: PlacePreview[]; packing: PackingPreview[]; note: NotePreview | null; purchases: PurchasePreview[]; expenses: ExpensePreview[]; travel: TravelPreview[] } = { itinerary: [], places: [], packing: [], note: null, purchases: [], expenses: [], travel: [] };
  let avatarUrl: string | null = null;
  const supabase = await createServerSupabaseClient();
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) redirect(`/login?next=/trips/${tripSlug}`);
    try {
      const tripId = await getTripIdBySlug(supabase, tripSlug);
      const { data: membership, error: membershipError } = await supabase.from("trip_members").select("status,role").eq("trip_id", tripId).eq("user_id", userData.user.id).maybeSingle<{ status: string; role: string }>();
      if (membershipError) throw membershipError;
      if (!membership || membership.status !== "approved") redirect(`/pending?trip=${tripSlug}`);
      const [itineraryResult, placesResult, packingResult, noteResult, purchaseResult, expenseResult, profileResult, travelResult] = await Promise.all([
        supabase.from("itinerary_items").select("event_date,event_time,title,place,place_id").eq("trip_id", tripId).order("event_date").order("event_time").limit(8),
        supabase.from("trip_places").select("id,name,map_url").eq("trip_id", tripId).order("name").limit(6),
        supabase.from("packing_items").select("name,is_ready").eq("trip_id", tripId).order("created_at").limit(4),
        supabase.from("shared_notes").select("title,body").eq("trip_id", tripId).order("updated_at", { ascending: false }).limit(1).maybeSingle<NotePreview>(),
        supabase.from("purchases").select("planned_amount,purchased_amount,is_purchased").eq("trip_id", tripId),
        supabase.from("expenses").select("amount,payment_status,settlement_status").eq("trip_id", tripId),
        supabase.from("profiles").select("avatar_url").eq("id", userData.user.id).maybeSingle<{ avatar_url: string | null }>(),
        supabase.from("itinerary_items").select("travel_estimated_cost").eq("trip_id", tripId),
      ]);
      if (itineraryResult.error || placesResult.error || packingResult.error || noteResult.error || purchaseResult.error || expenseResult.error || travelResult.error) throw new Error("Failed to load home data");
      preview = { itinerary: itineraryResult.data ?? [], places: placesResult.data ?? [], packing: packingResult.data ?? [], note: noteResult.data ?? null, purchases: purchaseResult.data ?? [], expenses: expenseResult.data ?? [], travel: travelResult.data ?? [] };
      avatarUrl = profileResult.data?.avatar_url ?? null;
    } catch (error) {
      if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error;
      console.error("Failed to load trip portal", { tripSlug, error });
      redirect(`/login?error=trip_access&next=/trips/${tripSlug}`);
    }
  }

  const start = Date.parse(`${site.startDate}T00:00:00+09:00`);
  const daysUntil = Math.max(0, Math.ceil((start - Date.now()) / 86_400_000));
  const next = preview.itinerary.find((item) => item.event_date && item.event_date >= new Date().toISOString().slice(0, 10)) ?? preview.itinerary[0] ?? null;
  const nextPlace = next
    ? preview.places.find((place) => place.id === next.place_id)
      ?? preview.places.find((place) => place.name.trim() === next.place.trim())
    : null;
  const planned = preview.purchases.reduce((sum, item) => sum + item.planned_amount, 0);
  const purchased = preview.purchases.reduce((sum, item) => sum + (item.is_purchased ? item.purchased_amount : 0), 0);
  const expenses = preview.expenses.reduce((sum, item) => sum + item.amount, 0);
  const travel = preview.travel.reduce((sum, item) => sum + item.travel_estimated_cost, 0);

  return <main className={`trip-portal-shell ${site.theme.heroClassName}`} style={{ "--trip-accent": site.theme.accent, "--trip-accent-dark": site.theme.accentDark, "--trip-surface": site.theme.surface, "--trip-background": site.theme.background } as CSSProperties}>
    <TripHeader tripSlug={tripSlug} tripName={site.title} avatarUrl={avatarUrl} />
    <section className="trip-portal-hero"><p className="trip-portal-eyebrow">Trip Journal</p><div className="trip-hero-title-row"><h1>{site.title}</h1></div><p className="trip-portal-description">{site.description}</p><div className="trip-portal-meta"><span>{site.dateLabel}</span><span>{site.locationLabel}</span></div></section>
    <section className="home-highlight-grid" aria-label="旅の概要"><article className="home-countdown-card"><span>出発まで</span><strong>{daysUntil}</strong><small>日</small><p>{site.dateLabel}</p></article><article className="home-next-card"><span>次の行き先</span>{next ? <><h2>{nextPlace?.name ?? next.place ?? "場所未設定"}</h2><p>{next.event_date?.replaceAll("-", "/")} {next.event_time?.slice(0, 5) || "時間未定"}｜{next.title}</p>{nextPlace?.map_url.trim() && <a href={nextPlace.map_url} target="_blank" rel="noreferrer">Googleマップを開く</a>}</> : <p>旅程を追加すると、次の行き先がここに表示されます。</p>}</article></section>
    <section className="trip-portal-section" aria-labelledby="trip-overview"><div className="trip-section-heading"><div><p>TRIP OVERVIEW</p><h2 id="trip-overview">旅の見開き</h2></div><span>SHARED SPACE</span></div><div className="portal-preview-grid">
      <PreviewCard href={`/trips/${site.slug}/itinerary`} title="旅程" meta="TIMELINE">{preview.itinerary.length ? <div className="portal-mini-timeline">{preview.itinerary.slice(0, 3).map((item, index) => <div key={`${item.title}-${index}`}><b>{item.event_time?.slice(0, 5) || "未定"}</b><span>{item.title}</span><small>{nextPlace?.name ?? item.place}</small></div>)}</div> : <p>まだ予定はありません</p>}</PreviewCard>
      <PreviewCard href={`/trips/${site.slug}/budget`} title="費用と精算" meta="COST"><strong className="portal-big-number">{expenses.toLocaleString("ja-JP")}円</strong><p>購入済み {purchased.toLocaleString("ja-JP")} / 予定総額 {(planned + travel).toLocaleString("ja-JP")}円</p><small>移動予定 {travel.toLocaleString("ja-JP")}円を含む</small></PreviewCard>
      <PreviewCard href={`/trips/${site.slug}/prep`} title="持ち物" meta="PACKING">{preview.packing.length ? <ul className="portal-check-list">{preview.packing.map((item) => <li key={item.name}>{item.is_ready ? "✓" : "○"} {item.name}</li>)}</ul> : <p>まだ持ち物はありません</p>}</PreviewCard>
      <PreviewCard href={`/trips/${site.slug}/prep`} title="共有メモ" meta="NOTES">{preview.note ? <><strong>{preview.note.title}</strong><p>{preview.note.body || "内容はまだありません"}</p></> : <p>まだ共有メモはありません</p>}</PreviewCard>
    </div></section>
    <section className="home-places" aria-labelledby="home-places-heading"><div className="trip-section-heading"><div><p>PLACES</p><h2 id="home-places-heading">行き先</h2></div><Link href={`/trips/${site.slug}/itinerary`}>一覧・編集</Link></div><div className="home-place-grid">{preview.places.slice(0, 4).map((place) => <article className="home-place-card" key={place.id}><h3>{place.name}</h3><div>{place.map_url && <a href={place.map_url} target="_blank" rel="noreferrer">Googleマップを開く</a>}</div></article>)}</div>{!preview.places.length && <p className="empty-state">旅程タブから行き先を登録できます。</p>}</section>
    <TripTabs tripSlug={tripSlug} active="home" />
  </main>;
}

function PreviewCard({ href, title, meta, children }: { href: string; title: string; meta: string; children: React.ReactNode }) { return <Link className="portal-preview-card" href={href}><p>{meta}<span>→</span></p><h3>{title}</h3><div>{children}</div></Link>; }
