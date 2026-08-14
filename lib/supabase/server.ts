import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseEnv } from "./env";

export async function createServerSupabaseClient() {
  const env = getSupabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always mutate cookies. Middleware handles
          // session refresh for requests that need it.
        }
      },
    },
  });
}

/**
 * Route Handler 用の Supabase クライアント。
 * 認証で更新される Cookie は、必ず返却する Response に積む必要がある。
 */
export function createRouteSupabaseClient(request: Request, response: NextResponse) {
  const env = getSupabaseEnv();
  if (!env) return null;

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.headers.get("cookie")
          ?.split(/;\s*/)
          .filter(Boolean)
          .map((value) => {
            const separator = value.indexOf("=");
            return {
              name: value.slice(0, separator),
              value: value.slice(separator + 1),
            };
          }) ?? [];
      },
      setAll(values) {
        values.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}

export function redirectWithAuthCookies(destination: URL, source: NextResponse) {
  const response = NextResponse.redirect(destination);
  source.cookies.getAll().forEach(({ name, value, ...options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
