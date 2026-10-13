"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * MFA körs server-side.
 *
 * Sessionscookies är httpOnly, så ingen JavaScript i webbläsaren kan läsa dem.
 * Det skyddar mot att en XSS stjäl sessionen – priset är att Supabase
 * webbläsarklient inte kan användas, och därför går TOTP-flödet via
 * server actions med användarens egen session.
 */

export type EnrollState =
  | { kind: "idle" }
  | { kind: "verifiera"; factorId: string }
  | { kind: "registrera"; factorId: string; secret: string }
  | { kind: "fel"; message: string };

/** Hämtar befintlig faktor eller skapar en ny som ska bekräftas. */
export async function startMfa(): Promise<EnrollState> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { kind: "fel", message: error.message };

  // `data.totp` innehåller endast bekräftade faktorer. Obekräftade finns bara i
  // `data.all`, så de måste läsas därifrån.
  const totp = (data?.all ?? []).filter((f) => f.factor_type === "totp");

  const verified = totp.find((f) => f.status === "verified");
  if (verified) return { kind: "verifiera", factorId: verified.id };

  // Städa bort påbörjade men obekräftade faktorer så att inskrivningen kan göras om.
  // Hemligheten går inte att hämta igen, därför startas inskrivningen från början.
  for (const f of totp) {
    const removed = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (removed.error) return { kind: "fel", message: removed.error.message };
  }

  const enrolled = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `BERRYiT Control Center ${new Date().toISOString()}`,
  });
  if (enrolled.error) return { kind: "fel", message: enrolled.error.message };

  return { kind: "registrera", factorId: enrolled.data.id, secret: enrolled.data.totp.secret };
}

export type VerifyState = { error?: string; done?: boolean };

/** Verifierar engångskoden och höjer sessionen till aal2. */
export async function verifyMfa(_prev: VerifyState | undefined, formData: FormData): Promise<VerifyState> {
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!factorId || code.length < 6) return { error: "Ange den sexsiffriga koden." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "Koden stämmer inte. Försök igen." };

  return { done: true };
}
