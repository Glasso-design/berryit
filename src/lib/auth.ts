import "server-only";

import { redirect } from "next/navigation";
import { SELECT, TABLE } from "@berryit/shared/api";
import { buildAccessContext, needsMfa } from "@berryit/shared/domain";
import type { AccessContext, Profile, RawSupportGrant } from "@berryit/shared/domain";
import { createSupabaseServerClient } from "./supabase/server";

/*
 * Server-side sessions- och behörighetskontroll.
 *
 * Allt läses med användarens egen JWT genom RLS: profiles visar bara egen rad,
 * support_role_grants bara egna tilldelningar. Frontend är därför aldrig den
 * som avgör behörighet – databasen gör det, och UI:t speglar bara resultatet.
 *
 * Själva uträkningen (vem är personal, vem är Super Admin, vilka tilldelningar
 * är aktiva) ligger i @berryit/shared/domain och delas med desktopappen.
 */

export type { AccessContext, Profile, SupportGrant } from "@berryit/shared/domain";
export { displayName, roleLabel } from "@berryit/shared/domain";

export async function getAccessContext(): Promise<AccessContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: grants }, { data: aal }, authority] = await Promise.all([
    supabase.from(TABLE.profiles).select(SELECT.profile).eq("id", user.id).maybeSingle<Profile>(),
    supabase
      .from(TABLE.supportRoleGrants)
      .select(SELECT.grants)
      .eq("grantee_id", user.id)
      .is("revoked_at", null),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc("support_access_context"),
  ]);
  if (authority.error) throw new Error("Backend saknar verifierad behörighetskontext; godkänd schemaförnyelse krävs.");
  if(authority.data?.accountActive!==true)return null;

  return buildAccessContext({
    userId: user.id,
    email: user.email ?? null,
    profile: profile ?? null,
    grants: (grants ?? []) as RawSupportGrant[],
    currentLevel: aal?.currentLevel ?? null,
    nextLevel: aal?.nextLevel ?? null,
    authority: authority.data,
  });
}

/** Inloggad användare krävs. */
export async function requireUser(): Promise<AccessContext> {
  const ctx = await getAccessContext();
  if (!ctx) redirect("/control/login");
  return ctx;
}

/**
 * Inloggad + MFA uppfylld där det krävs.
 *
 * Super Admin måste nå aal2. Saknas faktor skickas hen till inskrivning,
 * annars till verifiering. Ingen administrativ vy renderas dessförinnan.
 */
export async function requireSession(): Promise<AccessContext> {
  const ctx = await requireUser();
  if (needsMfa(ctx)) redirect("/control/mfa");
  return ctx;
}

/** Personalvyer: tekniker, admin eller någon aktiv supporttilldelning. */
export async function requireStaff(): Promise<AccessContext> {
  const ctx = await requireSession();
  if (!ctx.isStaff) redirect("/control?nekad=personal");
  return ctx;
}

/** Endast Super Admin, och endast med MFA. */
export async function requireSuperAdmin(): Promise<AccessContext> {
  const ctx = await requireSession();
  if (!ctx.isSuperAdmin) redirect("/control?nekad=superadmin");
  return ctx;
}
