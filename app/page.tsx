import Link from "next/link";

export default function Home() {
  return (
    <main className="portal-shell">
      <section className="portal-hero">
        <p className="portal-kicker">TRIP PORTAL</p>
        <h1>旅の計画を、ここに。</h1>
        <p>費用・旅程・持ち物を旅行ごとにまとめるためのポータル。</p>
      </section>
      <section className="portal-section" aria-labelledby="current-trips">
        <div className="section-heading">
          <div><p>UPCOMING</p><h2 id="current-trips">計画中の旅行</h2></div>
          <span>1 trip</span>
        </div>
        <Link className="trip-card" href="/trips/shikoku-saburo-bbq-2026/budget">
          <div className="trip-date"><strong>04</strong><span>SEP 2026</span></div>
          <div className="trip-copy">
            <p>徳島・高知｜1泊2日</p>
            <h3>四国三郎の郷 BBQ旅</h3>
            <span>費用計算を開く →</span>
          </div>
        </Link>
      </section>
    </main>
  );
}
