/*
 * Anslutning till BERRYiT:s egna, självhostade Supabase-stack (prod-node-01).
 *
 * Endast anon-nyckeln får nå webbläsaren – RLS är det som skyddar datan.
 * Service role-nyckeln läses aldrig här och finns inte i någon klientmodul.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Control Center kräver backend. Utan konfiguration visas ett tydligt fel i stället för en trasig sida. */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function assertSupabaseConfigured() {
  if (!supabaseConfigured) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_ANON_KEY saknas – se .env.example och supabase/README.md.",
    );
  }
}
