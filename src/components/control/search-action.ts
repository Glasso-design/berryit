"use server";

import { LIMIT, SELECT, TABLE, ticketSearchFilter } from "@berryit/shared/api";
import { searchTermSchema } from "@berryit/shared/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SearchHit = { id: string; reference: string; subject: string; status_key: string };

/**
 * Sökning körs server-side med användarens egen session, eftersom
 * sessionscookies är httpOnly. RLS avgör träffarna: en kund hittar bara sina
 * egna ärenden. Endast ärenden är sökbara – moduler utan backend finns inte här.
 *
 * Filter och gränser kommer från det delade API-kontraktet, så att
 * desktopappens sökning beter sig identiskt.
 */
export async function searchTickets(term: string): Promise<SearchHit[]> {
  const parsed = searchTermSchema.safeParse(term);
  if (!parsed.success) return [];

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from(TABLE.tickets)
    .select(SELECT.ticketSearch)
    .or(ticketSearchFilter(parsed.data))
    .order("updated_at", { ascending: false })
    .limit(LIMIT.search);

  return (data ?? []) as SearchHit[];
}
