/*
 * Tester för övervakningens delade kontrakt och för AI-underlaget.
 *
 * Det viktigaste som prövas: att "vet inte" aldrig blir "fungerar", och att
 * underlaget till ONARLY AI varken innehåller hemligheter eller skickas av sig
 * självt.
 */
import { describe, expect, it } from "vitest";
import {
  HEALTH_STATES,
  deriveHealth,
  formatMetric,
  healthLabel,
  healthTone,
  isStaleSample,
  latestPerMetric,
  severityLabel,
  summarizeHealth,
} from "@berryit/shared/monitoring";
import type { Incident, MetricKind, MonitoringSample, MonitoringThreshold } from "@berryit/shared/monitoring";
import { bundleLeaks, buildIncidentAiBundle, mayShareWithAi, sanitize } from "@berryit/shared/incident-ai";

const NU = Date.parse("2026-10-13T12:00:00Z");
const vid = (sekunderSedan: number) => new Date(NU - sekunderSedan * 1000).toISOString();

const kinds: Record<string, MetricKind> = {
  cpu_percent: { key: "cpu_percent", label: "CPU-belastning", unit: "procent", direction: "above", min_value: 0, max_value: 100 },
  disk_available_bytes: { key: "disk_available_bytes", label: "Ledigt diskutrymme", unit: "byte", direction: "below", min_value: 0, max_value: null },
};

const prov = (over: Partial<MonitoringSample> = {}): MonitoringSample => ({
  id: Math.random().toString(36),
  organization_id: "org-1",
  node_id: "node-1",
  service_id: null,
  metric_key: "cpu_percent",
  value: 30,
  collected_at: vid(60),
  source: "agent",
  detail: {},
  ...over,
});

const troskel = (over: Partial<MonitoringThreshold> = {}): MonitoringThreshold => ({
  id: "t1",
  organization_id: "org-1",
  metric_key: "cpu_percent",
  scope_kind: "node",
  node_id: "node-1",
  service_id: null,
  warning_value: 80,
  critical_value: 95,
  consecutive_breaches: 3,
  recovery_samples: 3,
  stale_after_seconds: 900,
  is_enabled: true,
  ...over,
});

describe("statusspråket", () => {
  it("har sju lägen som hålls isär", () => {
    expect(HEALTH_STATES).toEqual([
      "online",
      "warning",
      "critical",
      "offline",
      "stale",
      "unknown",
      "not_connected",
    ]);
  });

  it("namnger dem på svenska", () => {
    expect(healthLabel("online")).toBe("Fungerar");
    expect(healthLabel("stale")).toBe("Föråldrad mätning");
    expect(healthLabel("not_connected")).toBe("Ej ansluten");
    expect(healthLabel("unknown")).toBe("Okänd");
  });

  it("målar bara det som är känt – okänt och föråldrat är dämpat", () => {
    expect(healthTone("online")).toBe("ok");
    expect(healthTone("warning")).toBe("warn");
    expect(healthTone("critical")).toBe("bad");
    expect(healthTone("offline")).toBe("bad");
    expect(healthTone("unknown")).toBe("muted");
    expect(healthTone("stale")).toBe("muted");
    expect(healthTone("not_connected")).toBe("muted");
  });

  it("namnger allvarlighetsgrader", () => {
    expect(severityLabel("critical")).toBe("Kritisk");
    expect(severityLabel("info")).toBe("Information");
  });
});

describe("härledd hälsa", () => {
  const bas = { hasIntegration: true, reachable: true as boolean | null, thresholds: [troskel()], kinds, now: NU };

  it("utan koppling är läget ej ansluten", () => {
    expect(deriveHealth({ ...bas, hasIntegration: false, samples: [] }).state).toBe("not_connected");
  });

  it("konstaterat nere väger tyngre än mätvärden", () => {
    expect(deriveHealth({ ...bas, reachable: false, samples: [prov({ value: 10 })] }).state).toBe("offline");
  });

  it("inga mätvärden ger okänt, inte fungerar", () => {
    expect(deriveHealth({ ...bas, samples: [] }).state).toBe("unknown");
  });

  it("enbart gamla mätvärden ger föråldrad, inte fungerar", () => {
    expect(deriveHealth({ ...bas, samples: [prov({ collected_at: vid(5000), value: 10 })] }).state).toBe("stale");
  });

  it("värde över kritisk gräns ger kritiskt", () => {
    const ut = deriveHealth({ ...bas, samples: [prov({ value: 97 })] });
    expect(ut.state).toBe("critical");
    expect(ut.worstMetric).toBe("cpu_percent");
  });

  it("värde över varningsgräns ger varning", () => {
    expect(deriveHealth({ ...bas, samples: [prov({ value: 85 })] }).state).toBe("warning");
  });

  it("friska värden med nådd tjänst ger fungerar", () => {
    expect(deriveHealth({ ...bas, samples: [prov({ value: 12 })] }).state).toBe("online");
  });

  it("friska värden men okänd tillgänglighet ger okänt", () => {
    expect(deriveHealth({ ...bas, reachable: null, samples: [prov({ value: 12 })] }).state).toBe("unknown");
  });

  it("ett gammalt värde utvärderas inte mot tröskeln", () => {
    // Ett kritiskt men föråldrat värde ska inte larma som om det vore nu.
    const ut = deriveHealth({
      ...bas,
      samples: [prov({ value: 99, collected_at: vid(5000) }), prov({ value: 10, metric_key: "disk_available_bytes" })],
    });
    expect(ut.state).not.toBe("critical");
  });

  it("avstängda trösklar påverkar inte läget", () => {
    const ut = deriveHealth({ ...bas, thresholds: [troskel({ is_enabled: false })], samples: [prov({ value: 99 })] });
    expect(ut.state).toBe("online");
  });
});

describe("mätvärden", () => {
  it("senaste per mätvärdestyp plockas ur en fallande lista", () => {
    const senaste = latestPerMetric([
      prov({ value: 50, collected_at: vid(10) }),
      prov({ value: 90, collected_at: vid(70) }),
      prov({ metric_key: "disk_available_bytes", value: 5, collected_at: vid(20) }),
    ]);
    expect(senaste.get("cpu_percent")?.value).toBe(50);
    expect(senaste.size).toBe(2);
  });

  it("formaterar enheter läsbart", () => {
    expect(formatMetric(42.26, "procent")).toBe("42.3 %");
    expect(formatMetric(1536, "byte")).toBe("1.5 kB");
    expect(formatMetric(5_368_709_120, "byte")).toBe("5 GB");
    expect(formatMetric(7200, "sekunder")).toBe("2 h");
    expect(formatMetric(172800, "sekunder")).toBe("2 dygn");
    expect(formatMetric(12.7, "ms")).toBe("13 ms");
  });

  it("saknad mätning räknas som föråldrad", () => {
    expect(isStaleSample(undefined)).toBe(true);
    expect(isStaleSample(prov({ collected_at: "skräp" }))).toBe(true);
  });

  it("sammanfattningen håller isär lägena", () => {
    expect(summarizeHealth(["online", "unknown", "unknown", "critical"])).toEqual({
      online: 1,
      warning: 0,
      critical: 1,
      offline: 0,
      stale: 0,
      unknown: 2,
      not_connected: 0,
    });
  });
});

describe("underlag till ONARLY AI", () => {
  const incident: Incident = {
    id: "inc-1",
    organization_id: "org-1",
    node_id: "node-1",
    service_id: null,
    project_id: null,
    metric_key: "cpu_percent",
    incident_key: "metric_cpu_percent:node-1:-:cpu_percent",
    group_key: "node:node-1",
    title: "kund-a-vps: cpu_percent kritiskt",
    summary: "3 mätningar i rad över gränsen.",
    severity: "critical",
    status: "open",
    detected_by: "monitoring",
    opened_at: vid(600),
    last_seen_at: vid(60),
    observation_count: 4,
    acknowledged_at: null,
    resolved_at: null,
    resolved_reason: null,
  };

  const bundle = () =>
    buildIncidentAiBundle({
      incident,
      samples: [prov({ value: 97 }), prov({ metric_key: "disk_available_bytes", value: 1e9 })],
      kinds,
      organizationName: "Kund A AB",
      nodeName: "kund-a-vps",
      health: "critical",
      now: NU,
    });

  it("innehåller verifierade mätvärden med källa och tidsstämpel", () => {
    const b = bundle();
    expect(b.metrics).toHaveLength(2);
    for (const m of b.metrics) {
      expect(m.source).toBe("agent");
      expect(m.collected_at).toBeTruthy();
      expect(m.formatted).toBeTruthy();
    }
  });

  it("säger vad som inte ingår", () => {
    expect(bundle().omitted.some((o) => o.includes("Värdnamn"))).toBe(true);
  });

  it("innehåller inga hemligheter eller adresser", () => {
    expect(bundleLeaks(bundle())).toEqual([]);
  });

  it("tvättar nycklar, adresser och sökvägar ur text", () => {
    expect(sanitize("fel mot https://intern.example.test/api")).toBe("fel mot [dold adress]");
    expect(sanitize("token ghp_0123456789abcdefghij gick inte")).toBe("token [dold nyckel] gick inte");
    expect(sanitize("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toBe("[dold nyckel]");
    expect(sanitize("servern 192.168.1.44 svarar inte")).toBe("servern [dold adress] svarar inte");
    expect(sanitize("kunde inte nå /var/run/docker.sock")).toBe("kunde inte nå [dold sökväg]");
  });

  it("skickas aldrig utan uttryckligt bekräftande", () => {
    const utan = mayShareWithAi(bundle(), false);
    expect(utan.ok).toBe(false);
    expect(utan.reason).toMatch(/bekräftat/);
    expect(mayShareWithAi(bundle(), true).ok).toBe(true);
  });

  it("föråldrade mätvärden märks i stället för att tystas", () => {
    const b = buildIncidentAiBundle({
      incident,
      samples: [prov({ value: 97, collected_at: vid(5000) })],
      kinds,
      organizationName: "Kund A AB",
      health: "stale",
      now: NU,
    });
    expect(b.metrics[0].stale).toBe(true);
    expect(b.omitted.some((o) => o.includes("föråldrade"))).toBe(true);
  });
});
