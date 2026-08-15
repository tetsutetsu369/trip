import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { getTripSiteConfig } from "@/lib/trips/site-config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTripIdBySlug } from "@/lib/trips/membership";
import TripHeader from "@/app/components/TripHeader";

type ItineraryPreview = { event_date: string | null; event_time: string | null; title: string; place: string };
type PackingPreview = { name: string; is_ready: boolean };
type NotePreview = { title: string; body: string };
type BudgetPreview = { people?: number; purchases?: { bought?: boolean; cost?: number }[] };

export default async function TripPortalPage({ params }: { params: Promise<{ tripSlug: string }> }) {
  const { tripSlug } = await params;
  const site = getTripSiteConfig(tripSlug);
  if (!site) notFound();

  let preview: { itinerary: ItineraryPreview[]; packing: PackingPreview[]; note: NotePreview | null; budget: BudgetPreview | null } = { itinerary: [], packing: [], note: null, budget: null };
  let isAdmin = false;
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
      isAdmin = membership.role === "admin";
      const [itineraryResult, packingResult, noteResult, settingsResult, profileResult] = await Promise.all([
        supabase.from("itinerary_items").select("event_date,event_time,title,place").eq("trip_id", tripId).order("event_date").order("event_time").limit(3),
        supabase.from("packing_items").select("name,is_ready").eq("trip_id", tripId).order("created_at").limit(4),
        supabase.from("shared_notes").select("title,body").eq("trip_id", tripId).order("updated_at", { ascending: false }).limit(1).maybeSingle<NotePreview>(),
        supabase.from("trip_settings").select("budget").eq("trip_id", tripId).maybeSingle<{ budget: BudgetPreview }>(),
        supabase.from("profiles").select("avatar_url").eq("id", userData.user.id).maybeSingle<{ avatar_url: string | null }>(),
      ]);
      preview = { itinerary: itineraryResult.data ?? [], packing: packingResult.data ?? [], note: noteResult.data ?? null, budget: settingsResult.data?.budget ?? null };
      avatarUrl = profileResult.data?.avatar_url ?? null;
    } catch (error) {
      console.error("Failed to load trip portal", { tripSlug, error });
      redirect(`/login?error=trip_access&next=/trips/${tripSlug}`);
    }
  }

  const purchases = preview.budget?.purchases ?? [];
  const paidPurchases = purchases.filter((purchase) => purchase.bought).length;
  const purchaseTotal = purchases.reduce((total, purchase) => total + (purchase.cost ?? 0), 0);

  return <main className={`trip-portal-shell ${site.theme.heroClassName}`} style={{ "--trip-accent": site.theme.accent, "--trip-accent-dark": site.theme.accentDark, "--trip-surface": site.theme.surface, "--trip-background": site.theme.background } as CSSProperties}>
    <TripHeader tripSlug={tripSlug} active="portal" showAdmin={isAdmin} avatarUrl={avatarUrl} />
    <section className="trip-portal-hero"><div className="trip-hero-glow" aria-hidden="true" /><p className="trip-portal-eyebrow">Trip Journal</p><div className="trip-hero-title-row"><div className="trip-hero-stamp trip-hero-stamp-primary" aria-hidden="true">BBQ<br />PHOTO</div><h1>{site.title}</h1></div><p className="trip-portal-description">{site.description}</p><div className="trip-portal-meta"><span>{site.dateLabel}</span><span>{site.locationLabel}</span></div><div className="trip-hero-stamp trip-hero-stamp-secondary" aria-hidden="true">CAMPFIRE<br />PHOTO</div></section>
    <section className="trip-portal-section" aria-labelledby="trip-overview"><div className="trip-section-heading"><div><p>TRIP OVERVIEW</p><h2 id="trip-overview">旅のいま</h2></div><span>SHARED SPACE</span></div><div className="portal-preview-grid">
      <PreviewCard href={`/trips/${site.slug}/itinerary`} title="次の旅程" meta="TIMELINE">{preview.itinerary.length ? <div className="portal-mini-timeline">{preview.itinerary.map((item, index) => <div key={`${item.title}-${index}`}><b>{item.event_time?.slice(0, 5) || "未定"}</b><span>{item.title}</span><small>{item.place}</small></div>)}</div> : <p>まだ予定はありません</p>}</PreviewCard>
      <PreviewCard href={`/trips/${site.slug}/budget`} title="購入品・予算" meta="BUDGET"><strong className="portal-big-number">{purchaseTotal.toLocaleString("ja-JP")}円</strong><p>購入済み {paidPurchases} / {purchases.length} 件</p><small>{preview.budget?.people ? `${preview.budget.people}人で精算予定` : "予算を設定できます"}</small></PreviewCard>
      <PreviewCard href={`/trips/${site.slug}/packing`} title="持ち物" meta="PACKING">{preview.packing.length ? <ul className="portal-check-list">{preview.packing.map((item) => <li key={item.name}>{item.is_ready ? "✓" : "○"} {item.name}</li>)}</ul> : <p>まだ持ち物はありません</p>}</PreviewCard>
      <PreviewCard href={`/trips/${site.slug}/notes`} title="共有メモ" meta="NOTES">{preview.note ? <><strong>{preview.note.title}</strong><p>{preview.note.body || "本文はまだありません"}</p></> : <p>まだ共有メモはありません</p>}</PreviewCard>
    </div></section>
    <p className="trip-portal-footnote">各カードを開くと、保存済みデータの確認と下書きの追加・DB保存ができます。</p>
  </main>;
}

function PreviewCard({ href, title, meta, children }: { href: string; title: string; meta: string; children: React.ReactNode }) { return <Link className="portal-preview-card" href={href}><p>{meta}<span>→</span></p><h3>{title}</h3><div>{children}</div></Link>; }
