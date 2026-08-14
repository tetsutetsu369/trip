import { NextResponse } from "next/server";
import { getSupabaseEnv, getTripSlug } from "@/lib/supabase/env";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const next = requestUrl.searchParams.get("next");
  const supabase = getSupabaseEnv();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?error=configuration", origin));
  }

  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : `/trips/${getTripSlug()}`;
  const edgeLogin = new URL(`${supabase.url}/functions/v1/line-login`);
  edgeLogin.searchParams.set("next", safeNext);
  edgeLogin.searchParams.set("return_to", `${origin}/auth/edge-callback`);
  return NextResponse.redirect(edgeLogin);
}
