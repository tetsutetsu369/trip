import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/trips/admin";

export async function POST(request: Request) {
  const body = await request.json() as { trip?: string; displayName?: string };
  const supabase = await createServerSupabaseClient();
  if (!supabase || !body.trip || !body.displayName?.trim()) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const context = await getAdminContext(supabase, body.trip);
  if (!context) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { error } = await supabase.from("trip_participants").insert({ trip_id: context.trip.id, display_name: body.displayName.trim() });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const body = await request.json() as { trip?: string; participantId?: string; memberId?: string };
  const supabase = await createServerSupabaseClient();
  if (!supabase || !body.trip || !body.participantId || !body.memberId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const context = await getAdminContext(supabase, body.trip);
  if (!context) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: member } = await supabase.from("trip_members").select("user_id").eq("id", body.memberId).eq("trip_id", context.trip.id).maybeSingle<{ user_id: string }>();
  if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  const { error } = await supabase.from("trip_participants").update({ profile_id: member.user_id }).eq("id", body.participantId).eq("trip_id", context.trip.id).is("profile_id", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
