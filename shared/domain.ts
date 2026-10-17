/*
 * Domäntyper och behörighetslogik som måste vara identisk i webben och
 * desktopappen.
 *
 * Viktigt: funktionerna här avgör bara vad gränssnittet *visar*. All verklig
 * behörighet ligger i databasens RLS-policyer – ett gränssnitt som räknar fel
 * kan inte ge åtkomst till data som policyerna nekar.
 */

export type AppRole = "customer" | "technician" | "admin";

export type TicketStatusKey = "mottaget" | "pagar" | "vantar_pa_kund" | "lost" | "stangt";

export const TICKET_STATUS_KEYS: readonly TicketStatusKey[] = [
  "mottaget",
  "pagar",
  "vantar_pa_kund",
  "lost",
  "stangt",
] as const;

export type TicketPriorityKey = "lag" | "normal" | "hog" | "akut";

export const TICKET_PRIORITY_KEYS: readonly TicketPriorityKey[] = ["lag", "normal", "hog", "akut"] as const;

/** Rollnyckeln för central supportauktoritet (se migration 20261013090300). */
export const SUPER_ADMIN_ROLE_KEY = "BERRYIT_SUPPORT_SUPER_ADMIN";

export type Organization = {
  id: string;
  name: string;
  org_no: string | null;
};

export type Profile = {
  id: string;
  role: AppRole;
  full_name: string | null;
  email: string | null;
  organization_id: string | null;
  is_org_admin: boolean;
};

export type SupportGrant = {
  role_key: string;
  scope: "global" | "organization";
  organization_id: string | null;
  project_id?: string | null;
};

/** Rå rad från support_role_grants, innan utgångna poster filtrerats bort. */
export type RawSupportGrant = SupportGrant & {
  revoked_at?: string | null;
  expires_at?: string | null;
};

export type TicketRow = {
  id: string;
  project_id?: string | null;
  reference: string;
  subject: string;
  status_key: string;
  priority_key: string;
  updated_at: string;
  organization_id: string | null;
  assignee_id: string | null;
};

/** Autentiseringsnivå: aal1 = lösenord, aal2 = lösenord + MFA. */
export type AssuranceLevel = "aal1" | "aal2" | null;

export type AccessContext = {
  userId: string;
  email: string | null;
  profile: Profile | null;
  grants: SupportGrant[];
  isStaff: boolean;
  isSuperAdmin: boolean;
  permissions?: string[];
  roles?: string[];
  requiresMfa?: boolean;
  currentLevel: AssuranceLevel | string | null;
  nextLevel: AssuranceLevel | string | null;
};

/** Tar bort återkallade och utgångna tilldelningar. */
export function activeGrants(rows: RawSupportGrant[] | null | undefined, now = Date.now()): SupportGrant[] {
  return (rows ?? [])
    .filter((g) => !g.revoked_at)
    .filter((g) => !g.expires_at || new Date(g.expires_at).getTime() > now)
    .map((g) => ({ role_key: g.role_key, scope: g.scope, organization_id: g.organization_id }));
}

/** Presenter serverns auktoritativa svar; profil/grant-flaggor ger inga förmågor. */
export function buildAccessContext(input: {
  userId: string;
  email: string | null;
  profile: Profile | null;
  grants: RawSupportGrant[] | null | undefined;
  currentLevel: string | null;
  nextLevel: string | null;
  now?: number;
  authority?: {isStaff:boolean;isSuperAdmin:boolean;permissions:string[];roles:string[];requiresMfa:boolean} | null;
}): AccessContext {
  const grants = activeGrants(input.grants, input.now);
  return {
    userId: input.userId,
    email: input.email ?? input.profile?.email ?? null,
    profile: input.profile,
    grants,
    isStaff: input.authority?.isStaff === true,
    isSuperAdmin: input.authority?.isSuperAdmin === true,
    permissions: input.authority?.permissions ?? [],
    roles: input.authority?.roles ?? [],
    requiresMfa: input.authority?.requiresMfa === true,
    currentLevel: input.currentLevel,
    nextLevel: input.nextLevel,
  };
}

/** Super Admin måste nå aal2 innan någon administrativ vy får visas. */
export function needsMfa(ctx: AccessContext): boolean {
  return (ctx.requiresMfa === true || ctx.isSuperAdmin) && ctx.currentLevel !== "aal2";
}

export function displayName(ctx: AccessContext): string {
  return ctx.profile?.full_name?.trim() || ctx.email || "Inloggad";
}

export function roleLabel(ctx: AccessContext): string {
  if (ctx.isSuperAdmin) return "Super Admin";
  if (ctx.roles?.length) return ctx.roles.join(", ");
  if (ctx.profile?.is_org_admin) return "Kundkontakt";
  return "Kund";
}

/** Ärendereferens: BIT-ÅÅÅÅ-NNNN (sätts av databasen, valideras i klienten). */
export const TICKET_REFERENCE_PATTERN = /^BIT-\d{4}-\d{4,}$/;
