/*
 * Behörighetskontext för desktopklienten.
 *
 * Läsningarna görs med användarens egen JWT, exakt som i webben, och
 * uträkningen delas via @berryit/shared/domain. Gränssnittet speglar bara det
 * databasen tillåter – RLS är det som faktiskt avgör, och en klient som räknar
 * fel får ändå inga rader.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIMIT, SELECT, TABLE } from "@berryit/shared/api";
import { buildAccessContext } from "@berryit/shared/domain";
import type { AccessContext, Organization, Profile, RawSupportGrant } from "@berryit/shared/domain";

export async function loadAccessContext(supabase: SupabaseClient): Promise<AccessContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, grantRes, aalRes, authority] = await Promise.all([
    supabase.from(TABLE.profiles).select(SELECT.profile).eq("id", user.id).maybeSingle(),
    supabase
      .from(TABLE.supportRoleGrants)
      .select(SELECT.grants)
      .eq("grantee_id", user.id)
      .is("revoked_at", null),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc("support_access_context"),
  ]);
  if (authority.error) throw new Error("Backend saknar verifierad behörighetskontext. Kontrollera den godkända migrationsgrinden.");
  if(authority.data?.accountActive!==true)throw new Error("Kontot är inaktivt eller väntar på separat aktivering.");

  return buildAccessContext({
    userId: user.id,
    email: user.email ?? null,
    profile: (profileRes.data as Profile | null) ?? null,
    grants: (grantRes.data ?? []) as RawSupportGrant[],
    currentLevel: aalRes.data?.currentLevel ?? null,
    nextLevel: aalRes.data?.nextLevel ?? null,
    authority: authority.data,
  });
}

/** Organisationer användaren får se. Kunder ser sin egen, personal ser alla. */
export async function loadOrganizations(supabase: SupabaseClient): Promise<Organization[]> {
  const { data } = await supabase
    .from(TABLE.organizations)
    .select(SELECT.organization)
    .order("name")
    .limit(LIMIT.organizations);
  return (data ?? []) as Organization[];
}
