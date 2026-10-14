/*
 * Infrastructure Monitoring V1 – utvärdering och incidentbeslut.
 *
 * Bygger vidare på Connector Engine. Ingen parallell plattform: mätvärdena
 * hänger på samma noder och tjänster som registret, och incidenterna hamnar i
 * samma `incidents`-tabell som förut.
 *
 * Modulen är avsiktligt ren räkning utan sidoeffekter. Den tar emot mätvärden,
 * trösklar och öppna incidenter, och lämnar tillbaka beslut. Att skriva till
 * databasen görs av engine.mjs. Det gör hela larmlogiken testbar utan databas,
 * och det är den delen som måste gå att lita på.
 *
 * Tre regler bär logiken:
 *
 *   1. Saknad data är inte ett friskt system. Uteblivna mätvärden öppnar en
 *      egen incident och stänger aldrig en befintlig.
 *   2. En avvikelse är inte en incident. Trösklarna kräver flera brott i rad
 *      innan något öppnas, och flera friska mätningar innan något stängs.
 *   3. Samma fel är en incident, inte många. Identiteten (`incident_key`)
 *      avgör, och sammanhörande fel på samma nod delar `group_key`.
 */

export const SEVERITY = { critical: "critical", warning: "major", info: "info" };

/** Statusorden gränssnittet använder. "unknown" och "stale" är riktiga svar. */
export const HEALTH = ["online", "warning", "critical", "offline", "stale", "unknown", "not_connected"];

/**
 * Är värdet över (eller under) gränsen?
 * Riktningen kommer från mätvärdestypen: CPU är dåligt när det är högt,
 * ledigt diskutrymme när det är lågt.
 */
export function breaches(value, limit, direction) {
  if (limit === null || limit === undefined) return false;
  return direction === "below" ? value < limit : value > limit;
}

/** Vilken nivå ett enskilt värde ligger på. */
export function levelFor(value, threshold, direction) {
  if (breaches(value, threshold.critical_value, direction)) return "critical";
  if (breaches(value, threshold.warning_value, direction)) return "warning";
  return "ok";
}

/**
 * Räknar hur många mätningar i rad, räknat från den senaste, som bryter.
 * Flera brott i rad är skillnaden mellan en topp och ett problem.
 */
export function consecutiveBreaches(samples, threshold, direction) {
  let antal = 0;
  let varsta = "ok";
  for (const sample of samples) {
    const niva = levelFor(Number(sample.value), threshold, direction);
    if (niva === "ok") break;
    antal += 1;
    if (niva === "critical") varsta = "critical";
    else if (varsta !== "critical") varsta = "warning";
  }
  return { antal, niva: varsta };
}

/** Hur gammalt ett mätvärde får vara innan det inte beskriver nuläget. */
export function isStale(collectedAt, staleAfterSeconds, now = Date.now()) {
  if (!collectedAt) return true;
  const t = Date.parse(collectedAt);
  if (Number.isNaN(t)) return true;
  return now - t > staleAfterSeconds * 1000;
}

/** Identiteten som avgör om något är samma incident igen. */
export function incidentKey({ kind, nodeId = null, serviceId = null, metricKey = null }) {
  return [kind, nodeId ?? "-", serviceId ?? "-", metricKey ?? "-"].join(":");
}

/** Sammanhörande incidenter: allt som rör samma nod grupperas ihop. */
export function groupKey({ nodeId = null, serviceId = null }) {
  return nodeId ? `node:${nodeId}` : `service:${serviceId}`;
}

/**
 * Utvärderar en nod eller tjänst och lämnar tillbaka vilka incidenter som ska
 * öppnas, observeras igen eller stängas.
 *
 * @param {object} input
 * @param {object} input.target            { organization_id, node_id?, service_id?, name }
 * @param {Array}  input.samples           mätvärden, nyaste först
 * @param {Array}  input.thresholds        gällande trösklar för målet
 * @param {Array}  input.openIncidents     öppna incidenter för organisationen
 * @param {object} input.metricKinds       metric_key → { direction }
 * @param {boolean} [input.reachable]      null = okänt, inte "nere"
 * @param {number} [input.now]
 */
export function evaluateTarget({
  target,
  samples = [],
  thresholds = [],
  openIncidents = [],
  metricKinds = {},
  reachable = null,
  now = Date.now(),
}) {
  const beslut = [];
  const nodeId = target.node_id ?? null;
  const serviceId = target.service_id ?? null;
  const grupp = groupKey({ nodeId, serviceId });
  const oppnaPerNyckel = new Map(openIncidents.filter((i) => i.incident_key).map((i) => [i.incident_key, i]));

  const foreslaOppna = (kind, metricKey, severity, title, summary, detail = {}) => {
    const nyckel = incidentKey({ kind, nodeId, serviceId, metricKey });
    const befintlig = oppnaPerNyckel.get(nyckel);
    if (befintlig) {
      // Samma fel igen är inte en ny incident. Vi räknar upp och noterar det.
      // Beslutet bär samma fält som ett öppnande, så att den som läser listan
      // slipper tolka nyckelsträngen för att veta vad det gäller.
      beslut.push({
        action: "observe",
        incident: befintlig,
        incidentKey: nyckel,
        groupKey: grupp,
        kind,
        metricKey,
        severity,
        detail,
        nodeId,
        serviceId,
      });
    } else {
      beslut.push({
        action: "open",
        incidentKey: nyckel,
        groupKey: grupp,
        kind,
        metricKey,
        severity,
        title,
        summary,
        detail,
        nodeId,
        serviceId,
      });
    }
  };

  const foreslaStang = (kind, metricKey, detail = {}) => {
    const nyckel = incidentKey({ kind, nodeId, serviceId, metricKey });
    const befintlig = oppnaPerNyckel.get(nyckel);
    if (befintlig) {
      beslut.push({
        action: "resolve",
        incident: befintlig,
        incidentKey: nyckel,
        groupKey: grupp,
        kind,
        metricKey,
        reason: "recovered",
        detail,
        nodeId,
        serviceId,
      });
    }
  };

  // 1. Tillgänglighet. `null` betyder att vi inte vet – och okänt är inte nere.
  if (reachable === false) {
    foreslaOppna(
      nodeId ? "node_unreachable" : "service_offline",
      null,
      "critical",
      nodeId ? `${target.name} svarar inte` : `${target.name} är offline`,
      "Senaste kontrollen fick inget svar.",
      { reachable: false },
    );
  } else if (reachable === true) {
    foreslaStang(nodeId ? "node_unreachable" : "service_offline", null);
  }

  // 2. Uteblivna mätvärden. Egen incident – och den stänger aldrig någon annan.
  const staleGrans = thresholds[0]?.stale_after_seconds ?? 900;
  const senaste = samples[0] ?? null;
  const saknas = samples.length === 0 || isStale(senaste?.collected_at, staleGrans, now);
  if (saknas) {
    foreslaOppna(
      "monitoring_data_missing",
      null,
      "warning",
      `Inga färska mätvärden från ${target.name}`,
      senaste
        ? `Senaste mätvärdet är äldre än ${staleGrans} sekunder.`
        : "Det finns inga mätvärden alls för målet.",
      { last_sample_at: senaste?.collected_at ?? null, stale_after_seconds: staleGrans },
    );
  } else {
    foreslaStang("monitoring_data_missing", null, { last_sample_at: senaste.collected_at });
  }

  // 3. Trösklarna. Utan färska mätvärden utvärderas de inte alls: att låta en
  //    tom lista räknas som "under gränsen" vore att stänga larm på blindhet.
  for (const threshold of thresholds) {
    if (threshold.is_enabled === false) continue;
    const direction = metricKinds[threshold.metric_key]?.direction ?? "above";
    const forMatt = samples.filter((s) => s.metric_key === threshold.metric_key);

    if (saknas || forMatt.length === 0) continue;

    const { antal, niva } = consecutiveBreaches(forMatt, threshold, direction);
    const kravda = threshold.consecutive_breaches ?? 3;

    if (niva !== "ok" && antal >= kravda) {
      foreslaOppna(
        `metric_${threshold.metric_key}`,
        threshold.metric_key,
        niva === "critical" ? "critical" : "warning",
        `${target.name}: ${threshold.metric_key} ${niva === "critical" ? "kritiskt" : "högt"}`,
        `${antal} mätningar i rad över gränsen (senast ${forMatt[0].value}).`,
        {
          metric_key: threshold.metric_key,
          value: Number(forMatt[0].value),
          warning_value: threshold.warning_value,
          critical_value: threshold.critical_value,
          consecutive: antal,
          required: kravda,
        },
      );
    } else if (niva === "ok") {
      // Återhämtning kräver flera friska mätningar i rad, av samma skäl som
      // öppningen kräver flera brott.
      const friska = [];
      for (const s of forMatt) {
        if (levelFor(Number(s.value), threshold, direction) !== "ok") break;
        friska.push(s);
      }
      if (friska.length >= (threshold.recovery_samples ?? 3)) {
        foreslaStang(`metric_${threshold.metric_key}`, threshold.metric_key, {
          metric_key: threshold.metric_key,
          value: Number(forMatt[0].value),
          healthy_samples: friska.length,
        });
      }
    }
  }

  return beslut;
}

/**
 * Hälsan som ska visas för ett mål. Ordningen är medveten: det som inte går att
 * veta får aldrig se ut som att det fungerar.
 */
export function healthFor({ hasIntegration = true, reachable = null, stale = false, worstLevel = "ok" }) {
  if (!hasIntegration) return "not_connected";
  if (reachable === false) return "offline";
  if (stale) return "stale";
  if (reachable === null && worstLevel === "ok") return "unknown";
  if (worstLevel === "critical") return "critical";
  if (worstLevel === "warning") return "warning";
  return "online";
}

/** Sammanfattning över flera mål. Visar antal per läge, utan att slå ihop dem. */
export function summarize(healths) {
  const sammanfattning = { online: 0, warning: 0, critical: 0, offline: 0, stale: 0, unknown: 0, not_connected: 0 };
  for (const h of healths) if (h in sammanfattning) sammanfattning[h] += 1;
  return sammanfattning;
}
