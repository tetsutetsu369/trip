import Link from "next/link";

const errorMessages: Record<string, string> = {
  configuration: "認証設定がまだ完了していません。管理者に連絡してください。",
  oauth: "LINEログインを開始できませんでした。時間をおいて再試行してください。",
  callback: "LINEログインの応答を確認できませんでした。もう一度お試しください。",
  exchange: "ログイン情報を確認できませんでした。もう一度お試しください。",
  session: "ログインセッションを確認できませんでした。もう一度お試しください。",
  provision: "参加申請を作成できませんでした。管理者に連絡してください。",
  trip_access: "旅行情報または参加者情報を確認できませんでした。管理者に連絡してください。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const message = error ? errorMessages[error] : null;
  const loginHref = next && next.startsWith("/") && !next.startsWith("//")
    ? `/auth/login?next=${encodeURIComponent(next)}`
    : "/auth/login";

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-eyebrow">TRIP PORTAL</p>
        <h1>旅のしおりへログイン</h1>
        <p>参加者だけが、旅の予定と費用を一緒に編集できます。</p>
        {message && <p className="auth-error" role="alert">{message}</p>}
        <a className="line-login-button" href={loginHref}>
          LINEでログイン
        </a>
        <Link className="auth-back-link" href="/">トップへ戻る</Link>
      </section>
    </main>
  );
}
