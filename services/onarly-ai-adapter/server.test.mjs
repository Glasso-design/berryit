import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  AI_PATH,
  buildSupportPrompt,
  createAiHandler,
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
