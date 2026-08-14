import { NextResponse } from "next/server";
import { createRouteSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { accessToken?: string; refreshToken?: string } | null;
  if (!body?.accessToken || !body.refreshToken) return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  const response = NextResponse.json({ ok: true });
  const supabase = createRouteSupabaseClient(request, response);
  if (!supabase) return NextResponse.json({ error: "configuration" }, { status: 500 });
  const { error } = await supabase.auth.setSession({ access_token: body.accessToken, refresh_token: body.refreshToken });
  if (error) return NextResponse.json({ error: "session_exchange_failed" }, { status: 401 });
  return response;
}
