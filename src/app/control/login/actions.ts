"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Inloggning mot BERRYiT:s egen GoTrue. Ingen publik registrering finns –
 * konton skapas av BERRYiT. Sessionen läggs i httpOnly-cookies av @supabase/ssr.
 */
export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/control");

  if (!email || !password) {
    return { error: "Fyll i e-post och lösenord." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Samma meddelande oavsett om kontot finns: avslöja inte vilka konton som existerar.
    return { error: "Fel e-post eller lösenord." };
  }

  // Super Admin skickas vidare till MFA av requireSession() i layouten.
  redirect((next.startsWith("/control") ? next : "/control") as Route);
}
