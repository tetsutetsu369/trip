import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { linePassword, lineUserEmail } from "@/lib/auth/line";
import { getLineAuthEnv, getSupabaseEnv } from "@/lib/supabase/env";
import { createRouteSupabaseClient, redirectWithAuthCookies } from "@/lib/supabase/server";

type LineProfile = { userId: string; displayName?: string; pictureUrl?: string };

function safeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function redirect(origin: string, path: string, cookieResponse?: NextResponse) {
  const target = new URL(path, origin);
  return cookieResponse ? redirectWithAuthCookies(target, cookieResponse) : NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const savedState = cookieStore.get("line_oauth_state")?.value;
  const verifier = cookieStore.get("line_oauth_verifier")?.value;
  const next = safeNextPath(cookieStore.get("line_oauth_next")?.value);
  const lineAuth = getLineAuthEnv();
  const supabaseEnv = getSupabaseEnv();

  const callbackProblem = !code ? "code" : !state ? "state" : !savedState ? "state_cookie" : !verifier ? "verifier" : state !== savedState ? "state_mismatch" : !lineAuth ? "line_config" : !supabaseEnv ? "supabase_config" : null;
  if (callbackProblem) {
    console.error("LINE callback could not be validated", callbackProblem);
    return redirect(origin, `/login?error=callback&detail=${callbackProblem}`);
  }
  const verifiedCode = code!;
  const verifiedVerifier = verifier!;
  const verifiedLineAuth = lineAuth!;
  const verifiedSupabaseEnv = supabaseEnv!;

  const clearResponse = NextResponse.next();
  clearResponse.cookies.delete("line_oauth_state");
  clearResponse.cookies.delete("line_oauth_next");
  clearResponse.cookies.delete("line_oauth_verifier");

  let exchangeStage = "line_token";
  try {
    const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: verifiedCode,
        redirect_uri: `${origin}/auth/callback`,
        client_id: verifiedLineAuth.channelId,
        client_secret: verifiedLineAuth.channelSecret,
        code_verifier: verifiedVerifier,
      }),
    });
    const token = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenResponse.ok || !token.access_token) {
      exchangeStage = `line_token_${token.error ?? tokenResponse.status}`;
      throw new Error("LINE token exchange failed");
    }

    exchangeStage = "line_profile";
    const profileResponse = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const profile = await profileResponse.json() as LineProfile;
    if (!profileResponse.ok || !profile.userId) throw new Error("LINE profile retrieval failed");

    exchangeStage = "supabase_user";
    const email = lineUserEmail(profile.userId);
    const password = await linePassword(profile.userId, verifiedLineAuth.authSecret);
    const admin = createClient(verifiedSupabaseEnv.url, verifiedLineAuth.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { line_user_id: profile.userId, nickname: profile.displayName ?? "LINE参加者", avatar_url: profile.pictureUrl },
    });
    if (createError && !/already (been )?registered|already exists/i.test(createError.message)) throw createError;

    // A previous Supabase Custom Provider may have created a profile for this
    // stable LINE user id, without an email-based session.
    const { data: legacyProfile, error: legacyProfileError } = await admin
      .from("profiles")
      .select("id")
      .eq("line_user_id", profile.userId)
      .maybeSingle<{ id: string }>();
    if (legacyProfileError) throw legacyProfileError;

    exchangeStage = "supabase_session";
    const authResponse = NextResponse.next();
    const supabase = createRouteSupabaseClient(request, authResponse);
    if (!supabase) throw new Error("Supabase is not configured");
    const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({ email, password });
    if (sessionError || !sessionData.user) throw sessionError ?? new Error("No Supabase user");

    if (legacyProfile && legacyProfile.id !== sessionData.user.id) {
      exchangeStage = "legacy_membership_migration";
      const oldUserId = legacyProfile.id;
      const newUserId = sessionData.user.id;
      const { error: createProfileError } = await admin.from("profiles").upsert({
        id: newUserId,
        line_user_id: null,
        line_display_name: profile.displayName ?? "LINE参加者",
        nickname: profile.displayName ?? "LINE参加者",
        avatar_url: profile.pictureUrl ?? null,
        email,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (createProfileError) throw createProfileError;
      const transfers = await Promise.all([
        admin.from("trip_members").update({ user_id: newUserId }).eq("user_id", oldUserId),
        admin.from("itinerary_items").update({ created_by: newUserId }).eq("created_by", oldUserId),
        admin.from("receipts").update({ payer_id: newUserId }).eq("payer_id", oldUserId),
        admin.from("receipts").update({ created_by: newUserId }).eq("created_by", oldUserId),
        admin.from("expenses").update({ payer_id: newUserId }).eq("payer_id", oldUserId),
        admin.from("expenses").update({ created_by: newUserId }).eq("created_by", oldUserId),
        admin.from("expense_shares").update({ user_id: newUserId }).eq("user_id", oldUserId),
        admin.from("purchases").update({ assignee_id: newUserId }).eq("assignee_id", oldUserId),
        admin.from("purchases").update({ created_by: newUserId }).eq("created_by", oldUserId),
        admin.from("packing_items").update({ assignee_id: newUserId }).eq("assignee_id", oldUserId),
        admin.from("shared_notes").update({ created_by: newUserId }).eq("created_by", oldUserId),
        admin.from("change_logs").update({ actor_user_id: newUserId }).eq("actor_user_id", oldUserId),
      ]);
      const transferError = transfers.find(({ error }) => error)?.error;
      if (transferError) throw transferError;
      const { error: releaseLegacyProfileError } = await admin
        .from("profiles")
        .update({ line_user_id: null, updated_at: new Date().toISOString() })
        .eq("id", oldUserId);
      if (releaseLegacyProfileError) throw releaseLegacyProfileError;
    }

    const nextUrl = new URL(next, origin);
    const tripMatch = nextUrl.pathname.match(/^\/trips\/([^/]+)/);
    if (tripMatch) {
      exchangeStage = "trip_membership";
      const { data: trip, error: tripError } = await admin
        .from("trips")
        .select("id")
        .eq("slug", tripMatch[1])
        .maybeSingle<{ id: string }>();
      if (tripError || !trip) throw tripError ?? new Error("Trip not found");

      const { error: profileError } = await admin.from("profiles").upsert({
        id: sessionData.user.id,
        line_user_id: profile.userId,
        line_display_name: profile.displayName ?? "LINE参加者",
        nickname: profile.displayName ?? "LINE参加者",
        avatar_url: profile.pictureUrl ?? null,
        email,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (profileError) throw profileError;

      const { data: membership, error: membershipError } = await admin
        .from("trip_members")
        .select("id")
        .eq("trip_id", trip.id)
        .eq("user_id", sessionData.user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;

      if (!membership) {
        const { count, error: countError } = await admin
          .from("trip_members")
          .select("id", { count: "exact", head: true })
          .eq("trip_id", trip.id)
          .eq("status", "approved");
        if (countError) throw countError;
        const initialAdminLineUserId = process.env.INITIAL_ADMIN_LINE_USER_ID;
        const isInitialAdmin = (count ?? 0) === 0 || profile.userId === initialAdminLineUserId;
        const { error: insertError } = await admin.from("trip_members").insert({
          trip_id: trip.id,
          user_id: sessionData.user.id,
          status: isInitialAdmin ? "approved" : "pending",
          role: isInitialAdmin ? "admin" : "member",
          approved_at: isInitialAdmin ? new Date().toISOString() : null,
        });
        if (insertError) throw insertError;
      }
    }

    clearResponse.cookies.getAll().forEach(({ name, value, ...options }) => authResponse.cookies.set(name, value, options));
    return redirectWithAuthCookies(new URL(next, origin), authResponse);
  } catch (error) {
    console.error("Direct LINE OAuth callback failed", { exchangeStage, error });
    const errorText = error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? String((error as { code?: string; message?: string }).code ?? (error as { message?: string }).message ?? "unknown")
        : "unknown";
    const reason = errorText.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 80);
    return redirect(origin, `/login?error=exchange&detail=${encodeURIComponent(`${exchangeStage}_${reason}`)}`, clearResponse);
  }
}
