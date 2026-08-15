import Link from "next/link";

export type TripTab = "home" | "itinerary" | "budget" | "prep" | "me";

// 移動手段はこのタブ1つに集約する。各ページの個別「戻る」リンクは置かない。
const items = [
  ["home", "ホーム", "", <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /></>],
  ["itinerary", "旅程", "/itinerary", <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></>],
  ["budget", "費用", "/budget", <><path d="M7 5.5 12 12l5-6.5" /><path d="M12 12v6.5" /><path d="M8 13.5h8" /><path d="M8 16.5h8" /></>],
  ["prep", "準備", "/prep", <><rect x="4" y="4.5" width="16" height="15" rx="2.5" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>],
  ["me", "自分", "/me", <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 3.8-5.4 7-5.4S17.8 16.4 19 20" /></>],
] as const;

export default function TripTabs({ tripSlug, active }: { tripSlug: string; active: TripTab }) {
  return (
    <nav className="trip-tabs" aria-label="旅行メニュー">
      {items.map(([key, label, suffix, icon]) => (
        <Link key={key} className={active === key ? "is-active" : ""} href={`/trips/${tripSlug}${suffix}`} aria-current={active === key ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
          {label}
        </Link>
      ))}
    </nav>
  );
}
