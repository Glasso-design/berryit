/*
 * Connector Engine – motorn.
 *
 * Kör registrerade adaptrar mot integrationerna i BERRYiT:s eget register och
 * skriver tillbaka vad de såg. Den gör tre saker och inget mer:
 *
 *   läser integrationer  →  kör adaptern  →  skriver mätpunkt + aktivitetsrad
 *
 * Säkerhetsgränserna i klartext:
 *   • Motorn kör på servern och är den enda som ser tokens och socketar.
 *   • Den läser hemligheter ur serverns store med NAMNET ur registret. Finns
 *     inte namnet blir svaret "okänd" med en förklaring – inte ett påhittat ok.
 *   • Den vägrar köra en adapter som inte är rent läsande, och den vägrar köra
 *     en integration vars access_mode inte är read_only.
 *   • Resultat städas (se contract.sanitizeDetail) innan de sparas, så att en
 *     nyckel inte kan hamna i en detaljrad som visas i Desktop.
 */
import { ConnectorError, assertValidAdapter, errorResult } from "./contract.mjs";
import { ADAPTERS } from "./adapters.mjs";
import { containerMetrics, validateAgentReport } from "./agent-contract.mjs";
import { discoverRegisteredProject } from './project-discovery.mjs';

export class ConnectorEngine {
  /**
   * @param {object} options
   * @param {object} options.store    läs/skriv mot registret (se createRestStore)
   * @param {object} options.secrets  namn → hemlighet, enbart server-side
   * @param {Function} options.fetchImpl
   * @param {Function} [options.dockerList] läsare för Docker-socket
   * @param {number} [options.timeoutMs]
   * @param {Array} [options.adapters]
   */
  constructor({ store, secrets = {}, fetchImpl = fetch, dockerList = null, timeoutMs = 8000, adapters = ADAPTERS }) {
    if (!store) throw new Error("ConnectorEngine kräver en store");
    this.store = store;
    this.secrets = secrets;
    this.fetchImpl = fetchImpl;
    this.dockerList = dockerList;
    this.timeoutMs = timeoutMs;

    this.adapters = new Map();
    for (const adapter of adapters) {
      assertValidAdapter(adapter);
      this.adapters.set(adapter.key, adapter);
    }
  }

  /** Kör en enskild integration. Kastar aldrig – ett fel blir ett resultat. */
  async runIntegration(integration) {
    const adapter = this.adapters.get(integration.connector_key);
    if (!adapter) {
      return errorResult(
        integration.connector_key,
        new ConnectorError("NOT_CONFIGURED", `Ingen adapter för ${integration.connector_key}`),
      );
    }

    // Läsläge är inte en inställning motorn tolkar välvilligt: är den inte
    // read_only kör vi inte alls.
    if (integration.access_mode !== "read_only") {
      return errorResult(
        adapter.key,
        new ConnectorError("WRITE_REFUSED", `Integrationen har access_mode ${integration.access_mode}`),
      );
    }

    if (integration.is_enabled === false) {
      return errorResult(adapter.key, new ConnectorError("NOT_CONFIGURED", "Integrationen är inte aktiverad"));
    }

    const start = Date.now();
    try {
      return await adapter.check({
        config: integration.config ?? {},
        secretRef: integration.secret_ref ?? null,
        secrets: this.secrets,
        fetchImpl: this.fetchImpl,
        dockerList: this.dockerList,
        timeoutMs: this.timeoutMs,
      });
    } catch (fel) {
      return errorResult(adapter.key, fel, Date.now() - start);
    }
  }

  /**
   * Kör alla aktiverade integrationer för en organisation och sparar resultatet.
   * Returnerar en sammanfattning per integration.
   */
  async runForOrganization(organizationId) {
    const integrationer = await this.store.listIntegrations(organizationId);
    const sammanfattning = [];

    for (const integration of integrationer) {
      const resultat = await this.runIntegration(integration);
      if(!resultat.error&&integration.config?.discovery_enabled===true){
        try{
          const projectId=await discoverRegisteredProject({integration,secrets:this.secrets,store:this.store,fetchImpl:this.fetchImpl,timeoutMs:this.timeoutMs});
          resultat.discovery={status:'linked',project_id:projectId};
        }catch(error){resultat.discovery={status:'blocked',code:error.code??'INTERNAL'};}
      }

      // Mätpunkten hör till ett mål. Saknas målet finns inget att mäta på, och
      // då sparas ingen rad – hellre ingen historik än historik utan hemvist.
      if (integration.service_id || integration.node_id) {
        await this.store.recordStatus({
          organization_id: organizationId,
          service_id: integration.service_id ?? null,
          node_id: integration.node_id ?? null,
          integration_id: integration.id,
          status_key: resultat.status,
          checked_at: resultat.checkedAt,
          latency_ms: resultat.latencyMs,
          detail: resultat.detail,
          source: resultat.connector,
        });
      }

      await this.store.updateIntegrationStatus(integration.id, {
        status: statusForIntegration(resultat),
        last_checked_at: resultat.checkedAt,
        last_error: resultat.error ? `${resultat.error.code}: ${resultat.error.message}` : null,
      });

      await this.store.recordActivity({
        organization_id: organizationId,
        actor_kind: "connector",
        connector_key: integration.connector_key,
        action: "check",
        target_type: integration.scope_kind,
        target_id: integration.service_id ?? integration.node_id ?? integration.project_id ?? null,
        detail: { status: resultat.status, summary: resultat.summary },
      });

      sammanfattning.push({ integration: integration.id, ...resultat });
    }

    return sammanfattning;
  }
}

/**
 * Integrationens läge efter en körning.
 *
 * Skiljer på "anslutningen fungerar" och "tjänsten mår bra": en connector kan
 * vara ansluten och ändå rapportera att tjänsten är nere. Det är två olika
 * frågor och de ska inte blandas ihop i gränssnittet.
 */
export function statusForIntegration(resultat) {
  if (resultat.connector === "onarly_desk") return "not_configured";
  if (!resultat.error) return "connected";
  if (resultat.error.code === "NOT_CONFIGURED" || resultat.error.code === "MISSING_SECRET") return "not_configured";
  return "error";
}

/**
 * Store mot PostgREST med service-role.
 *
 * Nyckeln finns bara här, på servern. Windows-appen läser samma tabeller med
 * användarens egen JWT och ser då bara det RLS tillåter.
 */
export function createRestStore({ baseUrl, serviceRoleKey, fetchImpl = fetch }) {
  const bas = String(baseUrl).replace(/\/+$/, "");
  const anrop = async (path, init = {}) => {
    const svar = await fetchImpl(`${bas}/rest/v1${path}`, {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!svar.ok) {
      const text = await svar.text().catch(() => "");
      throw new Error(`Registret svarade ${svar.status}: ${text.slice(0, 200)}`);
    }
    return svar.status === 204 ? null : svar.json().catch(() => null);
  };

  return {
    async listIntegrations(organizationId) {
      return (
        (await anrop(
          `/connector_integrations?organization_id=eq.${organizationId}&is_enabled=eq.true&select=*`,
        )) ?? []
      );
    },
    async recordStatus(rad) {
      await anrop("/service_status_checks", { method: "POST", body: JSON.stringify(rad) });
    },
    async updateIntegrationStatus(id, patch) {
      await anrop(`/connector_integrations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async recordActivity(rad) {
      await anrop("/connector_activity_log", { method: "POST", body: JSON.stringify(rad) });
    },
    async reconcileProject(args){return anrop('/rpc/reconcile_discovered_project',{method:'POST',body:JSON.stringify(args)});},

    /* ----------------------------------------------- Infrastructure Monitoring */

    async recordSamples(rader) {
      if (!rader?.length) return;
      await anrop("/monitoring_samples", { method: "POST", body: JSON.stringify(rader) });
    },
    async listThresholds(organizationId) {
      return (
        (await anrop(
          `/monitoring_thresholds?organization_id=eq.${organizationId}&is_enabled=eq.true&select=*`,
        )) ?? []
      );
    },
    async listAgent(agentId) {
      const rader = await anrop(`/monitoring_agents?id=eq.${agentId}&select=*`);
      return rader?.[0] ?? null;
    },
    async touchAgent(agentId, patch) {
      await anrop(`/monitoring_agents?id=eq.${agentId}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async listOpenIncidents(organizationId) {
      return (
        (await anrop(
          `/incidents?organization_id=eq.${organizationId}&status=neq.resolved&select=*`,
        )) ?? []
      );
    },
    async openIncident(rad) {
      const skapad = await anrop("/incidents", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rad),
      });
      return Array.isArray(skapad) ? skapad[0] : skapad;
    },
    async touchIncident(id, patch) {
      await anrop(`/incidents?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async resolveIncident(id, patch) {
      await anrop(`/incidents?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async recordIncidentEvent(rad) {
      await anrop("/incident_events", { method: "POST", body: JSON.stringify(rad) });
    },
    async recentSamples(organizationId, { nodeId = null, serviceId = null, limit = 50 } = {}) {
      const mal = nodeId ? `node_id=eq.${nodeId}` : `service_id=eq.${serviceId}`;
      return (
        (await anrop(
          `/monitoring_samples?organization_id=eq.${organizationId}&${mal}` +
            `&select=*&order=collected_at.desc&limit=${limit}`,
        )) ?? []
      );
    },
  };
}

/**
 * Tar emot en rapport från den läsande agenten.
 *
 * Rapporten valideras innan ett enda värde sparas (se agent-contract.mjs). En
 * avvisad rapport sparar ingenting och noteras på agenten – resultatet blir att
 * mätvärden saknas, vilket övervakningen i sin tur öppnar en egen incident för.
 * Det är med flit: en förfalskad rapport ska inte kunna tysta ett larm.
 */
export async function ingestAgentReport({ store, agentId, report, now = Date.now() }) {
  const agent = await store.listAgent(agentId);
  try {
    const validerad = validateAgentReport(report, agent, now);

    // Containersiffrorna räknas här ur listan i stället för att tas på agentens
    // ord – två källor för samma siffra är en källa för mycket.
    validerad.samples = validerad.samples.filter(sample => !["containers_running", "containers_unhealthy"].includes(sample.metric_key));
    const harledda = Array.isArray(report.containers) ? containerMetrics(validerad.containers) : {};
    for (const [metric_key, value] of Object.entries(harledda)) {
      validerad.samples.push({
        organization_id: validerad.organization_id,
        node_id: validerad.node_id,
        service_id: null,
        metric_key,
        value,
        collected_at: validerad.collected_at,
        source: "agent",
        agent_id: validerad.agent_id,
        detail: {},
      });
    }

    await store.recordSamples(validerad.samples);
    await store.touchAgent(agent.id, { last_seen_at: validerad.collected_at, last_error: null });
    return { accepted: true, samples: validerad.samples.length, containers: validerad.containers.length };
  } catch (fel) {
    if (agent) {
      await store.touchAgent(agent.id, { last_error: `${fel.code ?? "INTERNAL"}: ${fel.message}` });
    }
    return { accepted: false, code: fel.code ?? "INTERNAL", message: fel.message };
  }
}
