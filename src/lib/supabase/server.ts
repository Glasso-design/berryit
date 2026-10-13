import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, assertSupabaseConfigured } from "./config";

/**
 * Supabase-klient för server components, server actions och route handlers.
 * Använder alltid anon-nyckeln: användarens JWT i cookien avgör behörighet,
 * och RLS i databasen avgör vad som får läsas och skrivas.
 */
export async function createSupabaseServerClient() {
  assertSupabaseConfigured();
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              // Secure så snart sidan serveras över https (produktion).
              secure: process.env.NODE_ENV === "production",
              path: "/",
            });
          }
        } catch {
          // Anropat från en server component: cookies sätts i stället av proxy.ts
          // vid nästa request. Sessionen förnyas där.
        }
      },
    },
  });
}
