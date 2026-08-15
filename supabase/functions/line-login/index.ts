import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type LineProfile = { userId: string; displayName?: string; pictureUrl?: string };
const encoder = new TextEncoder();

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, key: string) {
  return request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
}

function redirect(url: string, cookies: string[] = []) {
  return new Response(null, { status: 302, headers: { location: url, "set-cookie": cookies.join(", ") } });
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  // 末尾スラッシュを落としておく。付いたままだと `${appUrl}/?error=` が
  // `//?error=` になり、コールバックの一致判定も崩れる。
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const callbackUrl = Deno.env.get("LINE_CALLBACK_URL")!;
  // 戻り先の許可リスト。配信先を変えても APP_URL の変更だけで済むよう、
  // オリジンを直書きせずここから組み立てる。
  const fullPortalCallback = `${appUrl}/auth/edge-callback`;
  const channelId = Deno.env.get("LINE_CHANNEL_ID")!;
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET")!;
  const authSecret = Deno.env.get("LINE_AUTH_SECRET")!;
  const tripSlug = Deno.env.get("TRIP_SLUG") ?? "shikoku-saburo-bbq-2026";
  if (!appUrl || !callbackUrl || !channelId || !channelSecret || !authSecret) {
    return new Response("Authentication is not configured", { status: 500 });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    const state = crypto.randomUUID();
    const next = url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next")! : "/";
    const returnTo = url.searchParams.get("return_to") === fullPortalCallback ? fullPortalCallback : appUrl;
    const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authorize.search = new URLSearchParams({ response_type: "code", client_id: channelId, redirect_uri: callbackUrl, state, scope: "profile" }).toString();
    return redirect(authorize.toString(), [
      `line_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      `line_next=${encodeURIComponent(next)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      `line_return_to=${encodeURIComponent(returnTo)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    ]);
  }

  if (url.searchParams.get("state") !== readCookie(request, "line_state")) return redirect(`${appUrl}/?error=state`);

  try {
    const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl, client_id: channelId, client_secret: channelSecret }),
    });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) throw new Error("LINE token exchange failed");

    const profileResponse = await fetch("https://api.line.me/v2/profile", { headers: { authorization: `Bearer ${token.access_token}` } });
    const profile = await profileResponse.json() as LineProfile;
    if (!profileResponse.ok || !profile.userId) throw new Error("LINE profile failed");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const id = await digest(profile.userId);
    const email = `line-${id.slice(0, 40)}@trip.local`;
    const password = await digest(`${profile.userId}:${authSecret}`);
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error && !/already/i.test(created.error.message)) throw created.error;

    const signedIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const session = await signedIn.json() as { access_token?: string; refresh_token?: string; user?: { id: string } };
    if (!signedIn.ok || !session.user || !session.access_token || !session.refresh_token) throw new Error("Supabase session failed");

    const { data: trip, error: tripError } = await admin.from("trips").select("id").eq("slug", tripSlug).single<{ id: string }>();
    if (tripError || !trip) throw tripError ?? new Error("Trip missing");

    // Legacy authentication created a different auth user for the same LINE ID.
    // Preserve its data and copy only that verified identity's access level.
    const { data: legacyProfile } = await admin.from("profiles").select("id").eq("line_user_id", profile.userId).maybeSingle<{ id: string }>();
    const { error: profileError } = await admin.from("profiles").upsert({
      id: session.user.id,
      line_user_id: legacyProfile && legacyProfile.id !== session.user.id ? null : profile.userId,
      line_display_name: profile.displayName ?? "LINEユーザー",
      nickname: profile.displayName ?? "LINEユーザー",
      avatar_url: profile.pictureUrl ?? null,
      email,
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    const { data: membership, error: membershipError } = await admin.from("trip_members").select("id").eq("trip_id", trip.id).eq("user_id", session.user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      const { data: legacyMembership } = legacyProfile
        ? await admin.from("trip_members").select("role,status,approved_at").eq("trip_id", trip.id).eq("user_id", legacyProfile.id).maybeSingle()
        : { data: null };
      const { error: insertError } = await admin.from("trip_members").insert({
        trip_id: trip.id,
        user_id: session.user.id,
        role: legacyMembership?.role ?? "member",
        status: legacyMembership?.status ?? "pending",
        approved_at: legacyMembership?.approved_at ?? null,
      });
      if (insertError) throw insertError;
    }

    const next = decodeURIComponent(readCookie(request, "line_next") ?? "/");
    const returnTo = decodeURIComponent(readCookie(request, "line_return_to") ?? appUrl);
    return redirect(`${returnTo}#access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}&next=${encodeURIComponent(next)}`, [
      "line_state=; HttpOnly; Secure; Path=/; Max-Age=0",
      "line_next=; HttpOnly; Secure; Path=/; Max-Age=0",
      "line_return_to=; HttpOnly; Secure; Path=/; Max-Age=0",
    ]);
  } catch (error) {
    console.error(error);
    return redirect(`${appUrl}/?error=login`);
  }
});
