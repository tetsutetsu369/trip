export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function getLineProvider() {
  return process.env.SUPABASE_LINE_PROVIDER ?? "custom:line";
}

export function getLineAuthEnv() {
  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const authSecret = process.env.LINE_AUTH_SECRET;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!channelId || !channelSecret || !authSecret || !serviceRoleKey) return null;
  return { channelId, channelSecret, authSecret, serviceRoleKey };
}

export function getTripSlug() {
  return process.env.TRIP_SLUG ?? "shikoku-saburo-bbq-2026";
}
