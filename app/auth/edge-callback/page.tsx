"use client";

import { useEffect, useState } from "react";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/trips/shikoku-saburo-bbq-2026";
}

export default function EdgeCallbackPage() {
  const [message, setMessage] = useState("ログイン情報を確認しています…");

  useEffect(() => {
    const complete = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const next = safeNext(hash.get("next"));
      if (!accessToken || !refreshToken) {
        window.location.replace(`/login?error=callback&next=${encodeURIComponent(next)}`);
        return;
      }
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken, refreshToken }),
      });
      if (!response.ok) {
        setMessage("ログイン情報を保存できませんでした。もう一度お試しください。");
        return;
      }
      window.location.replace(next);
    };
    void complete();
  }, []);

  return <main className="auth-shell"><section className="auth-card"><p className="auth-eyebrow">LINE LOGIN</p><h1>{message}</h1></section></main>;
}
