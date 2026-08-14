import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/trips/admin";

const statuses = new Set(["approved", "rejected", "removed"]);
const roles = new Set(["member", "admin"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json() as { trip?: string; status?: string; role?: string; version?: number };
  const trip = body.trip ?? "shikoku-saburo-bbq-2026";
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "configuration" }, { status: 503 });

  const context = await getAdminContext(supabase, trip);
  if (!context) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (body.status && !statuses.has(body.status)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  if (body.role && !roles.has(body.role)) return NextResponse.json({ error: "invalid_role" }, { status: 400 });

  const { data: target } = await supabase.from("trip_members").select("id, user_id, role, status, version").eq("id", memberId).eq("trip_id", context.trip.id).single<{ id: string; user_id: string; role: string; status: string; version: number }>();
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.user_id === context.user.id) return NextResponse.json({ error: "self_change" }, { status: 400 });

  const removingAdmin = target.role === "admin" && (body.status === "removed" || body.role === "member");
  if (removingAdmin) {
    const { count } = await supabase.from("trip_members").select("id", { count: "exact", head: true }).eq("trip_id", context.trip.id).eq("role", "admin").eq("status", "approved");
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "last_admin" }, { status: 409 });
  }

  const update: Record<string, unknown> = {};
  if (body.status) { update.status = body.status; update.approved_at = body.status === "approved" ? new Date().toISOString() : null; update.removed_at = body.status === "removed" ? new Date().toISOString() : null; }
  if (body.role) update.role = body.role;
  const { data: updated, error } = await supabase.from("trip_members").update(update).eq("id", memberId).eq("trip_id", context.trip.id).eq("version", body.version ?? target.version).select("id, version").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "version_conflict" }, { status: 409 });
  return NextResponse.json({ ok: true, member: updated });
}

