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
  };
}
