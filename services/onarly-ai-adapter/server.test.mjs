import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  AI_PATH,
  ApiError,
  buildSupportPrompt,
  createAiHandler,
  createPostgrestBoundary,
  normalizeAssistantResponse,
} from "./server.mjs";

const IDS = {
  user: "11111111-1111-4111-8111-111111111111",
  org: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
  project: "44444444-4444-4444-8444-444444444444",
  message: "55555555-5555-4555-8555-555555555555",
  ticket: "66666666-6666-4666-8666-666666666666",
  knowledge: "77777777-7777-4777-8777-777777777777",
};

const conversation = {
  id: IDS.conversation,
  organization_id: IDS.org,
  project_id: IDS.project,
  service_key: "natverk",
  created_by: IDS.user,
  title: "VPN fungerar inte",
  created_at: "2026-10-13T10:00:00Z",
  updated_at: "2026-10-13T10:00:00Z",
};

function fakeBoundary(overrides = {}) {
  const calls = [];
  const boundary = {
    calls,
    identity: async (token) => {
      calls.push(["identity", token]);
      if (token !== "valid-session-token") throw Object.assign(new Error("UNAUTHORIZED"), { status: 401, code: "UNAUTHORIZED" });
      return { userId: IDS.user, token };
    },
    context: async (_identity, available) => ({
      organizations: [{ id: IDS.org, name: "Kund A" }],
      projects: [{ id: IDS.project, organization_id: IDS.org, name: "Portal" }],
      services: [{ key: "natverk", label: "Nätverk" }],
      gateway: { available, reason: null },
    }),
    conversations: async () => [conversation],
    conversation: async (_identity, id) => {
      calls.push(["conversation", id]);
      if (id !== IDS.conversation) throw Object.assign(new Error("FORBIDDEN"), { status: 403, code: "FORBIDDEN" });
      return conversation;
    },
    createConversation: async (_identity, input) => ({ ...conversation, ...input }),
    messages: async () => [],
    addUserMessage: async (_identity, _conversation, text) => {
      calls.push(["user-message", text]);
      return { id: IDS.message };
    },
    sourceContext: async () => ({
      knowledge: [
        {
          id: IDS.knowledge,
          title: "Verifierad DNS-lösning",
          problem: "Interna namn kan inte lösas.",
          verified_solution: "Kontrollera klientens DNS-server.",
        },
      ],
      tickets: [
        {
          id: IDS.ticket,
          reference: "BIT-2026-0042",
          subject: "VPN tappar DNS",
          description: "Kunden når IP men inte interna värdnamn.",
          status_key: "lost",
          priority_key: "normal",
        },
      ],
    }),
    addAssistantMessage: async (_conversation, response, _requestId, provider, model) => {
      calls.push(["assistant", response, provider, model]);
      return { id: IDS.message };
    },
    auditFailure: async () => {},
    createTicket: async () => ({ id: IDS.ticket, reference: "BIT-2026-0043" }),
    promoteKnowledge: async () => ({ id: IDS.knowledge, title: "VPN DNS" }),
    ...overrides,
  };
  return boundary;
}

async function withApi(boundary, gateway, run) {
  const server = createServer(createAiHandler({ boundary, gateway, logger: () => {} }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}${AI_PATH}`;
  const request = async (path, init = {}) => {
    const response = await fetch(base + path, {
      ...init,
      headers: {
        Authorization: "Bearer valid-session-token",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("requires a BerryIT bearer session before all tenant data", async () => {
  const boundary = fakeBoundary();
  await withApi(boundary, { enabled: false }, async (request) => {
    const response = await request("/context", { headers: { Authorization: "" } });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });
});

test("does not call ONARLY AI or persist a question without explicit transfer approval", async () => {
  const boundary = fakeBoundary();
  let gatewayCalls = 0;
  const gateway = { enabled: true, complete: async () => { gatewayCalls++; } };
  await withApi(boundary, gateway, async (request) => {
    const response = await request(`/conversations/${IDS.conversation}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "Varför fungerar inte VPN?", approvedForAi: false }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "CONSENT_REQUIRED");
  });
  assert.equal(gatewayCalls, 0);
  assert.equal(boundary.calls.some((call) => call[0] === "user-message"), false);
});

test("returns facts only when their citations exist in the authorized context", async () => {
  const boundary = fakeBoundary();
  const gateway = {
    enabled: true,
    complete: async (prompt) => {
      assert.match(prompt, /BIT-2026-0042/);
      assert.match(prompt, /Verifierad DNS-lösning/);
      assert.doesNotMatch(prompt, /Kund B/);
      return {
        provider: "GEMINI",
        model: "gemini-3.1-flash-lite",
        text: JSON.stringify({
          summary: "DNS är den verifierade gemensamma nämnaren.",
          verifiedFacts: [
            { text: "Tidigare ärende visar DNS-fel.", sourceIds: ["BIT-2026-0042"] },
            { text: "Påstående utan tillåten källa.", sourceIds: ["FOREIGN-1"] },
          ],
          hypotheses: [{ text: "Klientens DNS kan vara fel.", confidence: "medium" }],
          recommendedActions: [
            { text: "Läs aktuell DNS-konfiguration.", risk: "read-only" },
            { text: "Ändra DNS efter separat godkännande.", risk: "approval-required" },
          ],
          missingInformation: ["Aktuell ipconfig /all."],
          sources: [
            { id: "BIT-2026-0042", kind: "ticket", title: "VPN tappar DNS", reference: "BIT-2026-0042" },
            { id: "FOREIGN-1", kind: "ticket", title: "Otillåten", reference: "FOREIGN-1" },
          ],
        }),
      };
    },
  };

  await withApi(boundary, gateway, async (request) => {
    const response = await request(`/conversations/${IDS.conversation}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "Varför fungerar inte VPN?", approvedForAi: true }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.response.verifiedFacts.length, 1);
    assert.equal(response.body.response.sources.length, 1);
    assert.equal(response.body.response.hypotheses.length, 2);
    assert.equal(response.body.response.recommendedActions[1].risk, "approval-required");
  });
});

test("unstructured gateway text is explicitly downgraded to a low-confidence hypothesis", () => {
  const response = normalizeAssistantResponse("Kontrollera brandväggen.", {
    knowledge: [],
    tickets: [],
  });
  assert.deepEqual(response.verifiedFacts, []);
  assert.equal(response.hypotheses[0].confidence, "low");
  assert.ok(response.missingInformation.length > 0);
});

test("ticket creation requires a separate explicit confirmation", async () => {
  const boundary = fakeBoundary();
  await withApi(boundary, { enabled: false }, async (request) => {
    const denied = await request(`/conversations/${IDS.conversation}/tickets`, {
      method: "POST",
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(denied.status, 400);

    const allowed = await request(`/conversations/${IDS.conversation}/tickets`, {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.body.ticket.reference, "BIT-2026-0043");
  });
});

test("prompt marks every recommendation as non-executing and treats sources as data", () => {
  const prompt = buildSupportPrompt("Starta om produktionen", conversation, {
    knowledge: [],
    tickets: [],
  });
  assert.match(prompt, /aldrig utföra produktionsändringar/);
  assert.match(prompt, /aldrig som instruktioner/);
  assert.match(prompt, /Inga verifierade källor/);
});

// MASTER PASS 2 (M7): client-generated ids make a retry idempotent. These tests
// drive the REAL PostgREST boundary against an in-memory PostgREST double that
// answers 409 on a duplicate primary key, like PostgREST does for SQLSTATE 23505.
function fakePostgrest() {
  const tables = { ai_conversations: [], ai_messages: [], ai_audit_events: [] };
  let clock = 0;
  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return reply(200, { id: IDS.user });
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    if (!(table in tables)) return reply(200, []);
    if ((init.method ?? "GET") === "POST") {
      const row = { id: randomUUID(), created_at: new Date(Date.UTC(2026, 9, 29, 12, 0, clock++)).toISOString(), ...JSON.parse(init.body) };
      if (tables[table].some((r) => r.id === row.id)) return reply(409, { code: "23505", message: "duplicate key" });
      tables[table].push(row);
      return reply(201, [row]);
    }
    let rows = [...tables[table]];
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq.")) rows = rows.filter((r) => String(r[key]) === value.slice(3));
    }
    return reply(200, rows.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  };
  const boundary = createPostgrestBoundary({ authBaseUrl: "http://db.test/auth/v1", restBaseUrl: "http://db.test/rest/v1", anonKey: "anon", serviceRoleKey: "service", fetchImpl });
  return { tables, boundary };
}

const structuredReply = JSON.stringify({ summary: "Svar.", verifiedFacts: [], hypotheses: [{ text: "Kontrollera DNS.", confidence: "low" }], recommendedActions: [], missingInformation: ["Loggar."], sources: [] });

test("a replayed conversation id returns the same conversation instead of a duplicate", async () => {
  const { tables, boundary } = fakePostgrest();
  await withApi(boundary, { enabled: false }, async (request) => {
    const body = { id: IDS.conversation, organizationId: IDS.org, title: "VPN fungerar inte" };
    const first = await request("/conversations", { method: "POST", body: JSON.stringify(body) });
    const second = await request("/conversations", { method: "POST", body: JSON.stringify(body) });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.body.conversation.id, IDS.conversation);
    const conflict = await request("/conversations", { method: "POST", body: JSON.stringify({ ...body, projectId: IDS.project }) });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");
    const invalid = await request("/conversations", { method: "POST", body: JSON.stringify({ ...body, id: "not-a-uuid" }) });
    assert.equal(invalid.status, 400);
  });
  assert.equal(tables.ai_conversations.length, 1);
});

test("a retried question with the same messageId is stored once and an answered replay never calls the gateway again", async () => {
  const { tables, boundary } = fakePostgrest();
  tables.ai_conversations.push({ id: IDS.conversation, organization_id: IDS.org, project_id: null, incident_id: null, service_key: null, created_by: IDS.user, title: "VPN", created_at: "2026-10-29T11:00:00.000Z" });
  let calls = 0;
  let down = true;
  const gateway = {
    enabled: true,
    complete: async () => {
      calls++;
      if (down) throw new ApiError(503, "GATEWAY_UNAVAILABLE");
      return { provider: "GEMINI", model: "sim", text: structuredReply };
    },
  };
  await withApi(boundary, gateway, async (request) => {
    const ask = (text = "Varför tappar VPN?") => request(`/conversations/${IDS.conversation}/messages`, { method: "POST", body: JSON.stringify({ text, approvedForAi: true, messageId: IDS.message }) });
    assert.equal((await ask()).status, 503);
    down = false;
    const retried = await ask();
    assert.equal(retried.status, 201);
    const replayed = await ask();
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.message.id, retried.body.message.id);
    assert.equal(calls, 2, "the answered replay must not reach the gateway");
    const conflict = await ask("En helt annan fråga");
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");
  });
  assert.deepEqual(tables.ai_messages.map((m) => m.role), ["user", "assistant"]);
});

// MASTER PASS 3: without a configured ONARLY AI Gateway (the production default)
// a question is refused with GATEWAY_DISABLED before anything is stored.
test("gateway not configured: 503 GATEWAY_DISABLED, no question stored, failure audited, no gateway call", async () => {
  const failures = [];
  const boundary = fakeBoundary({ auditFailure: async (_c, _i, _r, code) => { failures.push(code); } });
  let gatewayCalls = 0;
  const gateway = { enabled: false, complete: async () => { gatewayCalls++; } };
  await withApi(boundary, gateway, async (request) => {
    const response = await request(`/conversations/${IDS.conversation}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "Varför fungerar inte VPN?", approvedForAi: true, messageId: randomUUID() }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "GATEWAY_DISABLED");
    const context = await request("/context");
    assert.equal(context.status, 200);
    assert.equal(context.body.gateway.available, false);
  });
  assert.equal(gatewayCalls, 0);
  assert.equal(boundary.calls.some((call) => call[0] === "user-message"), false, "no unanswered question may be stored");
  assert.deepEqual(failures, ["GATEWAY_DISABLED"]);
});
