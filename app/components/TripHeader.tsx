import Link from "next/link";

type TripHeaderProps = {
  tripSlug: string;
  active?: "portal" | "itinerary" | "budget" | "packing" | "notes" | "profile" | "admin";
  showAdmin?: boolean;
};

const items = [
  ["portal", "ポータル", ""],
  ["itinerary", "旅程", "/itinerary"],
  ["budget", "費用計算", "/budget"],
  ["packing", "持ち物", "/packing"],
  ["notes", "メモ", "/notes"],
  ["profile", "プロフィール", "/profile"],
] as const;

export default function TripHeader({ tripSlug, active = "portal", showAdmin = false }: TripHeaderProps) {
  return (
    <header className="trip-header">
      <Link className="trip-header-brand" href={`/trips/${tripSlug}`}>
        <span className="trip-header-mark" aria-hidden="true">TJ</span>
        <span><strong>Trip Journal</strong><small>四国三郎の郷 BBQ旅</small></span>
      </Link>
      <nav className="trip-header-nav" aria-label="旅行メニュー">
        {items.map(([key, label, suffix]) => (
          <Link key={key} className={active === key ? "is-active" : ""} href={`/trips/${tripSlug}${suffix}`}>
            {label}
          </Link>
        ))}
        {showAdmin && <Link className={active === "admin" ? "is-active admin-link" : "admin-link"} href={`/admin/members?trip=${tripSlug}`}>管理者</Link>}
      </nav>
    </header>
  );
}
