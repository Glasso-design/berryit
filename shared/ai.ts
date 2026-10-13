export type AiSourceKind = "ticket" | "knowledge" | "documentation" | "log";

export type AiSource = {
  id: string;
  kind: AiSourceKind;
  title: string;
  reference: string | null;
};

export type AiFact = {
  text: string;
  sourceIds: string[];
};

export type AiHypothesis = {
  text: string;
  confidence: "low" | "medium" | "high";
};

export type AiAction = {
  text: string;
  risk: "read-only" | "approval-required";
};

export type AiStructuredResponse = {
  summary: string;
  verifiedFacts: AiFact[];
  hypotheses: AiHypothesis[];
  recommendedActions: AiAction[];
  missingInformation: string[];
  sources: AiSource[];
};

export type AiProject = {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  repository_url: string | null;
};

export type AiService = {
  key: string;
  label: string;
};

export type AiConversation = {
  id: string;
  organization_id: string;
  project_id: string | null;
  service_key: string | null;
  created_by: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AiMessage = {
  id: string;
  conversation_id: string;
  organization_id: string;
  actor_id: string | null;
  role: "user" | "assistant";
  body: string;
  provider: string | null;
  model: string | null;
  structured_response: AiStructuredResponse | null;
  created_at: string;
};

export type AiContext = {
  organizations: Array<{ id: string; name: string }>;
  projects: AiProject[];
  services: AiService[];
  gateway: {
    available: boolean;
    reason: string | null;
  };
};

export type AiTicketResult = {
  id: string;
  reference: string;
};

export function isAiStructuredResponse(value: unknown): value is AiStructuredResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string") return false;
  if (!Array.isArray(v.verifiedFacts) || !Array.isArray(v.hypotheses)) return false;
  if (!Array.isArray(v.recommendedActions) || !Array.isArray(v.missingInformation)) return false;
  if (!Array.isArray(v.sources)) return false;

  const sources = v.sources.every((source) => {
    if (!source || typeof source !== "object") return false;
    const s = source as Record<string, unknown>;
    return (
      typeof s.id === "string" &&
      ["ticket", "knowledge", "documentation", "log"].includes(String(s.kind)) &&
      typeof s.title === "string" &&
      (s.reference === null || typeof s.reference === "string")
    );
  });
  const sourceIds = new Set(
    (v.sources as Array<Record<string, unknown>>)
      .map((source) => source.id)
      .filter((id): id is string => typeof id === "string"),
  );

  return (
    sources &&
    v.verifiedFacts.every((fact) => {
      if (!fact || typeof fact !== "object") return false;
      const f = fact as Record<string, unknown>;
      return (
        typeof f.text === "string" &&
        Array.isArray(f.sourceIds) &&
        f.sourceIds.every((id) => typeof id === "string" && sourceIds.has(id))
      );
    }) &&
    v.hypotheses.every((hypothesis) => {
      if (!hypothesis || typeof hypothesis !== "object") return false;
      const h = hypothesis as Record<string, unknown>;
      return (
        typeof h.text === "string" &&
        ["low", "medium", "high"].includes(String(h.confidence))
      );
    }) &&
    v.recommendedActions.every((action) => {
      if (!action || typeof action !== "object") return false;
      const a = action as Record<string, unknown>;
      return (
        typeof a.text === "string" &&
        ["read-only", "approval-required"].includes(String(a.risk))
      );
    }) &&
    v.missingInformation.every((item) => typeof item === "string")
  );
}

export function aiErrorMessage(code: string): string {
  const known: Record<string, string> = {
    UNAUTHORIZED: "Sessionen är inte längre giltig. Logga in igen.",
    FORBIDDEN: "Du saknar behörighet till den valda kunden eller konversationen.",
    CONSENT_REQUIRED: "Bekräfta att frågan får skickas till ONARLY AI.",
    GATEWAY_DISABLED: "ONARLY AI Gateway är inte konfigurerad på BerryIT-servern.",
    GATEWAY_UNAVAILABLE: "ONARLY AI Gateway kan inte nås just nu.",
    GATEWAY_TIMEOUT: "ONARLY AI svarade inte i tid.",
    RATE_LIMITED: "För många AI-frågor. Vänta en stund och försök igen.",
    INVALID_INPUT: "Frågan eller kontexten är ogiltig.",
    NO_VERIFIED_SOLUTION: "Det finns ingen verifierad lösning att spara.",
  };
  return known[code] ?? "AI-anropet misslyckades säkert. Försök igen eller samla mer diagnostik.";
}
