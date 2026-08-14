import { NextResponse } from "next/server";
import { createLineOAuthRequest, createPkceChallenge } from "@/lib/auth/line";
import { getLineAuthEnv, getTripSlug } from "@/lib/supabase/env";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const next = requestUrl.searchParams.get("next");
  const lineAuth = getLineAuthEnv();
  if (!lineAuth) {
    return NextResponse.redirect(new URL("/login?error=configuration", origin));
  }

  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : `/trips/${getTripSlug()}`;
  const redirectUri = `${origin}/auth/callback`;
  const { state, verifier, authorizationUrl } = createLineOAuthRequest(redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", lineAuth.channelId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("scope", "profile");
  authorizationUrl.searchParams.set("code_challenge", await createPkceChallenge(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizationUrl);
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: origin.startsWith("https://"), path: "/", maxAge: 600 };
  response.cookies.set("line_oauth_state", state, cookieOptions);
  response.cookies.set("line_oauth_next", safeNext, cookieOptions);
  response.cookies.set("line_oauth_verifier", verifier, cookieOptions);
  return response;
}
