/*
 * API-kontrakt mot den självhostade backenden.
 *
 * Båda klienterna pratar med samma gateway (Caddy i berryit-support-stacken):
 *   /auth/v1    GoTrue
 *   /rest/v1    PostgREST
 *   /storage/v1 storage-api
 *
 * Kontraktet samlar sökvägar, kolumnval och gränser på ett ställe så att en
 * ändring i databasen inte behöver hittas i två kodbaser.
 */
import type { TicketRow } from "./domain";

export const API_PREFIX = {
  auth: "/auth/v1",
  rest: "/rest/v1",
  storage: "/storage/v1",
} as const;

/** Hälsokontroll som fungerar utan inloggning (GoTrue svarar med sin version). */
export const HEALTH_PATH = `${API_PREFIX.auth}/health`;

export const TABLE = {
  organizations: "organizations",
  profiles: "profiles",
  tickets: "tickets",
  ticketStatuses: "ticket_statuses",
  ticketPriorities: "ticket_priorities",
  ticketCategories: "ticket_categories",
  ticketMessages: "ticket_messages",
  supportRoleGrants: "support_role_grants",
} as const;

/** Kolumnval. Håll dem minimala – RLS filtrerar rader, vi filtrerar fält. */
export const SELECT = {
  profile: "id, role, full_name, email, organization_id, is_org_admin",
  grants: "role_key, scope, organization_id, revoked_at, expires_at",
  organization: "id, name, org_no",
  ticketRow: "id, reference, subject, status_key, priority_key, updated_at",
  ticketSearch: "id, reference, subject, status_key",
} as const;

export const LIMIT = {
  search: 8,
  recentTickets: 8,
  ticketList: 200,
  organizations: 200,
} as const;

/** Bygger or-filtret för fritextsökning i PostgREST. */
export function ticketSearchFilter(term: string): string {
  const safe = term.replace(/[%,()]/g, "");
  return `reference.ilike.%${safe}%,subject.ilike.%${safe}%`;
}

export function sortTicketsByUpdated(rows: TicketRow[]): TicketRow[] {
  return [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/**
 * Moduler utan backend. Listan är avsiktligt explicit: en modul får inte visa
 * siffror eller status förrän den finns med som ansluten i nav.ts.
 */
export type ModuleRequirement = { title: string; description: string; requirements: string[] };

export const MODULE_REQUIREMENTS: Record<string, ModuleRequirement> = {
  projekt: {
    title: "Projekt är inte ansluten ännu",
    description: "Projektregister per kund med status, miljöer och koppling till repo.",
    requirements: [
      "Migration för tabellen projects (kund, namn, status, miljö)",
      "RLS enligt samma modell som övriga tabeller",
      "Koppling till GitHub/Vercel för byggstatus",
    ],
  },
  kommunikation: {
    title: "Kommunikation är inte ansluten ännu",
    description: "Chattar och externa kanaler samlade per kund och ärende.",
    requirements: [
      "Tabeller för konversationer och kanaler",
      "Inkommande kanal (t.ex. e-post eller Discord)",
      "Samtyckes- och gallringsregler",
    ],
  },
  ai: {
    title: "AI & Bots är inte ansluten ännu",
    description: "ONARLY AI Gateway och supportbottar.",
    requirements: [
      "Server-side anslutning till ONARLY AI Gateway med egen nyckel",
      "Botidentitet och behörighet i support_role_grants",
      "Loggning av AI-åtgärder i revisionen",
    ],
  },
  infrastruktur: {
    title: "Infrastruktur är inte ansluten ännu",
    description: "Servrar, containrar och tjänster för BERRYiT och ONARLY.",
    requirements: [
      "Tabellerna infrastructure_nodes/services/checks",
      "Agent som rapporterar in via service_role över Tailscale",
      "Behörighetsscope infra.read / infra.manage",
    ],
  },
  monitoring: {
    title: "Monitoring är inte ansluten ännu",
    description: "Hälsa, larm och historik för övervakade tjänster.",
    requirements: [
      "Infrastrukturagenten (se Infrastruktur)",
      "Larmregler och mottagare",
      "Historik för upptid och incidenter",
    ],
  },
  integrationer: {
    title: "Integrationer är inte ansluten ännu",
    description: "GitHub, Vercel och ONARLY DESK.",
    requirements: [
      "Tabellen integration_connections (referens till secret-namn, aldrig nycklar i databasen)",
      "Godkännande per integration från ägaren",
      "ONARLY DESK: aktivering kräver separat beslut",
    ],
  },
};
