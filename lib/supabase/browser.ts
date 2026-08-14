import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

let client: SupabaseClient | undefined;

export function createBrowserSupabaseClient() {
  if (client) return client;

  const env = getSupabaseEnv();
  if (!env) return null;

  client = createBrowserClient(env.url, env.anonKey);
  return client;
}

