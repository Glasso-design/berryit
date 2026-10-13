/*
 * Tester för det delade connector-kontraktet.
 *
 * Reglerna här avgör vad gränssnittet visar om driften, så de prövas en gång
 * och gäller både desktopklienten och motorn.
 */
import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  CONNECTOR_KEYS,
  READ_ONLY,
  STATUS_FRESHNESS_SECONDS,
  connectorDefinition,
  integrationStatusLabel,
  isConnected,
  isStale,
  lastCheckedLabel,
  latestStatusByTarget,
  secretRequirements,
  splitProjects,
  statusLabel,
} from "@berryit/shared/connectors";
import type { Organization, StatusCheck } from "@berryit/shared/connectors";

describe("connector-katalogen", () => {
  it("innehåller de sex connectors som utlovas", () => {
    expect(CONNECTOR_KEYS).toEqual([
      "docker",
      "github",
      "vercel",
      "onarly_ai",
      "onarly_desk",
      "http_health",
    ]);
  });

  it("ingen connector får skriva i den här versionen", () => {
    for (const key of CONNECTOR_KEYS) {
      expect(CONNECTORS[key].capabilities).toEqual(READ_ONLY);
      expect(CONNECTORS[key].capabilities.write).toBe(false);
    }
  });

  it("varje connector beskriver vilken identitet den ska använda", () => {
    for (const key of CONNECTOR_KEYS) {
      expect(CONNECTORS[key].identity.length).toBeGreaterThan(20);
    }
  });

  it("hemliga krav pekas ut så att de hamnar i serverns store", () => {
    expect(secretRequirements("github").map((r) => r.key)).toEqual(["token"]);
    expect(secretRequirements("vercel").map((r) => r.key)).toEqual(["token"]);
    // Varken HTTP-kontrollen eller vår egen AI-adapter behöver en nyckel i motorn.
    expect(secretRequirements("http_health")).toHaveLength(0);
    expect(secretRequirements("onarly_ai")).toHaveLength(0);
  });

  it("okänd connector ger null i stället för att kasta", () => {
    expect(connectorDefinition("finns-inte")).toBeNull();
  });
});

describe("statusspråk", () => {
  it("namnger lägena", () => {
    expect(statusLabel("ok")).toBe("Fungerar");
    expect(statusLabel("degraded")).toBe("Försämrad");
    expect(statusLabel("down")).toBe("Nere");
    expect(statusLabel("unknown")).toBe("Okänd");
  });

  it("ansluten är bara ansluten när den är verifierad", () => {
    expect(isConnected("connected")).toBe(true);
    expect(isConnected("configured")).toBe(false);
    expect(isConnected("error")).toBe(false);
    expect(isConnected("not_configured")).toBe(false);
  });

  it("ej ansluten säger det rakt ut", () => {
    expect(integrationStatusLabel("not_configured")).toBe("Ej ansluten");
    expect(integrationStatusLabel("error")).toBe("Fel vid senaste kontroll");
  });
});

describe("färskhet", () => {
  const nu = Date.parse("2026-10-13T12:00:00Z");

  it("en mätning som aldrig gjorts är gammal", () => {
    expect(isStale(null, nu)).toBe(true);
    expect(lastCheckedLabel(null, nu)).toBe("aldrig kontrollerad");
  });

  it("en färsk mätning är inte gammal", () => {
    expect(isStale("2026-10-13T11:55:00Z", nu)).toBe(false);
  });

  it("en mätning äldre än gränsen räknas som gammal", () => {
    const gammal = new Date(nu - (STATUS_FRESHNESS_SECONDS + 60) * 1000).toISOString();
    expect(isStale(gammal, nu)).toBe(true);
  });

  it("skräp i tidsstämpeln behandlas som okänt, inte som färskt", () => {
    expect(isStale("inte-ett-datum", nu)).toBe(true);
    expect(lastCheckedLabel("inte-ett-datum", nu)).toBe("okänd tidpunkt");
  });

  it("åldern beskrivs i ord", () => {
    expect(lastCheckedLabel("2026-10-13T11:59:30Z", nu)).toBe("kontrollerad nyss");
    expect(lastCheckedLabel("2026-10-13T11:30:00Z", nu)).toBe("kontrollerad för 30 min sedan");
    expect(lastCheckedLabel("2026-10-13T06:00:00Z", nu)).toBe("kontrollerad för 6 h sedan");
    expect(lastCheckedLabel("2026-10-11T12:00:00Z", nu)).toBe("kontrollerad för 2 dygn sedan");
  });
});

describe("senaste mätning per mål", () => {
  const check = (over: Partial<StatusCheck>): StatusCheck => ({
    id: Math.random().toString(36),
    organization_id: "org-1",
    service_id: null,
    node_id: null,
    status_key: "ok",
    checked_at: "2026-10-13T12:00:00Z",
    latency_ms: 10,
    source: "http_health",
    detail: {},
    ...over,
  });

  it("tar den första raden per mål ur en fallande lista", () => {
    const { services, nodes } = latestStatusByTarget([
      check({ service_id: "s1", status_key: "down", checked_at: "2026-10-13T12:00:00Z" }),
      check({ service_id: "s1", status_key: "ok", checked_at: "2026-10-13T11:00:00Z" }),
      check({ node_id: "n1", status_key: "degraded" }),
    ]);
    expect(services.get("s1")?.status_key).toBe("down");
    expect(nodes.get("n1")?.status_key).toBe("degraded");
    expect(services.has("s2")).toBe(false);
  });
});

describe("internt kontra kund", () => {
  const orgs: Organization[] = [
    { id: "o-intern", name: "BERRYiT", is_internal: true },
    { id: "o-kund", name: "Kund AB", is_internal: false },
  ];

  it("delar projekten efter organisationens flagga", () => {
    const { interna, kund } = splitProjects(
      [
        { organization_id: "o-intern", id: "p1" },
        { organization_id: "o-kund", id: "p2" },
        { organization_id: "o-kund", id: "p3" },
      ],
      orgs,
    );
    expect(interna.map((p) => p.id)).toEqual(["p1"]);
    expect(kund.map((p) => p.id)).toEqual(["p2", "p3"]);
  });

  it("ett projekt i en okänd organisation räknas som kundprojekt, inte som vårt", () => {
    const { interna, kund } = splitProjects([{ organization_id: "o-okand", id: "p9" }], orgs);
    expect(interna).toHaveLength(0);
    expect(kund).toHaveLength(1);
  });
});
