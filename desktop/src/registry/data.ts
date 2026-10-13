/*
 * Systemregistret, läst från desktopklienten.
 *
 * Allt går genom PostgREST med användarens egen JWT. Klienten har ingen
 * service-role-nyckel, ingen SSH-nyckel och ingen Docker-socket – den ser bara
 * det RLS släpper fram, och den kan inte köra en connector själv. Mätpunkterna
 * den visar är skrivna av motorn på servern.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REGISTRY_LIMIT,
  REGISTRY_SELECT,
  REGISTRY_TABLE,
  latestStatusByTarget,
} from "@berryit/shared/connectors";
import type {
  Integration,
  Node,
  Organization,
  Project,
  Service,
  StatusCheck,
} from "@berryit/shared/connectors";

export type RegistryData = {
  organizations: Organization[];
  projects: Project[];
  nodes: Node[];
  services: Service[];
  statusChecks: StatusCheck[];
  /** Senaste mätning per tjänst respektive nod. */
  latest: ReturnType<typeof latestStatusByTarget>;
  /** Null när användaren saknar behörighet att se integrationer. */
  integrations: Integration[] | null;
};

export const TOM_REGISTERDATA: RegistryData = {
  organizations: [],
  projects: [],
  nodes: [],
  services: [],
  statusChecks: [],
  latest: { services: new Map(), nodes: new Map() },
  integrations: null,
};

/**
 * Hämtar hela registret i ett svep.
 *
 * Integrationerna hämtas separat och får vara null: att sakna behörighet till
 * dem är ett normalt läge för en tekniker, och ska visas som "du ser inte det
 * här" – inte som en tom lista som ser ut som "det finns inga".
 */
export async function loadRegistry(supabase: SupabaseClient): Promise<RegistryData> {
  const [orgRes, projRes, nodeRes, svcRes, statusRes] = await Promise.all([
    supabase.from(REGISTRY_TABLE.organizations).select(REGISTRY_SELECT.organization).order("name"),
    supabase.from(REGISTRY_TABLE.projects).select(REGISTRY_SELECT.project).order("name").limit(REGISTRY_LIMIT.projects),
    supabase.from(REGISTRY_TABLE.nodes).select(REGISTRY_SELECT.node).order("name").limit(REGISTRY_LIMIT.nodes),
    supabase.from(REGISTRY_TABLE.services).select(REGISTRY_SELECT.service).order("name").limit(REGISTRY_LIMIT.services),
    supabase
      .from(REGISTRY_TABLE.statusChecks)
      .select(REGISTRY_SELECT.statusCheck)
      .order("checked_at", { ascending: false })
      .limit(REGISTRY_LIMIT.statusChecks),
  ]);

  const statusChecks = (statusRes.data ?? []) as StatusCheck[];

  const integrationRes = await supabase
    .from(REGISTRY_TABLE.integrations)
    .select(REGISTRY_SELECT.integration)
    .order("display_name")
    .limit(REGISTRY_LIMIT.integrations);

  return {
    organizations: (orgRes.data ?? []) as Organization[],
    projects: (projRes.data ?? []) as Project[],
    nodes: (nodeRes.data ?? []) as Node[],
    services: (svcRes.data ?? []) as Service[],
    statusChecks,
    latest: latestStatusByTarget(statusChecks),
    // RLS ger inget fel, bara noll rader, för den som saknar connectors.manage.
    // Vi skiljer ändå på "får inte se" och "finns inga" genom att fråga om
    // behörigheten separat nedan.
    integrations: integrationRes.error ? null : ((integrationRes.data ?? []) as Integration[]),
  };
}

/**
 * Får användaren hantera anslutningar någonstans?
 *
 * Används för att kunna säga "du saknar behörighet" i stället för att visa en
 * tom lista. Behörigheten kräver tvåfaktor, så en Super Admin som inte gjort
 * MFA får korrekt svaret nej.
 */
export async function canManageConnectors(supabase: SupabaseClient, organizationIds: string[]): Promise<boolean> {
  if (organizationIds.length === 0) return false;
  for (const id of organizationIds) {
    const { data, error } = await supabase.rpc("can_manage_connectors", { p_organization_id: id });
    if (!error && data === true) return true;
  }
  return false;
}
