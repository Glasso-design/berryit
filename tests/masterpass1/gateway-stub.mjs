// MASTER PASS 1 — SIM of the ONARLY AI Gateway (/chat contract used by
// services/onarly-ai-adapter). Never calls a real AI provider and holds no real
// key. Runs only inside the throwaway CI stack (network namespace of the
// adapter container), so the adapter reaches it on 127.0.0.1.
//
// Behaviour is selected per request from $STUB_DIR/mode.txt so the test
// harness can simulate provider failures without restarting anything:
//   ok | http503 | http500 | unauthorized | html | slow | garbage
// Every request is appended to $STUB_DIR/requests.jsonl (prompt included) so
// the tests can prove which tenant data reached the gateway.
import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";

const port = Number(process.env.STUB_PORT || 9911);
const token = process.env.STUB_TOKEN || "";
const dir = process.env.STUB_DIR || "/stub";
if (token.length < 16) throw new Error("STUB_TOKEN missing");

const mode = () => {
  try { return readFileSync(`${dir}/mode.txt`, "utf8").trim() || "ok"; } catch { return "ok"; }
};

function answer(prompt) {
  // Sources are rendered by buildSupportPrompt as "[ID] kind — title".
  const sources = [...prompt.matchAll(/^\[([A-Z0-9-]+)\] (ticket|knowledge) — (.*)$/gm)].map((m) => ({ id: m[1], kind: m[2], title: m[3] }));
  const facts = sources.slice(0, 2).map((s) => ({ text: `SIM: källa ${s.id} är relevant.`, sourceIds: [s.id] }));
  return {
    summary: sources.length ? `SIM-svar baserat på ${sources.length} källor.` : "SIM-svar utan källor.",
    verifiedFacts: [...facts, { text: "SIM: påstående med påhittad källa.", sourceIds: ["FOREIGN-TENANT-1"] }],
    hypotheses: [{ text: "SIM: hypotes.", confidence: "medium" }],
    recommendedActions: [{ text: "SIM: kontrollera loggar.", risk: "read-only" }, { text: "SIM: starta om tjänsten.", risk: "read-only-not-really" }],
    missingInformation: sources.length ? [] : ["SIM: inga källor fanns."],
    sources: [...sources.map((s) => ({ ...s, reference: null })), { id: "FOREIGN-TENANT-1", kind: "ticket", title: "Annan kund", reference: null }],
  };
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body = null;
  try { body = JSON.parse(raw); } catch { /* logged as invalid */ }
  const current = mode();
  const authOk = req.headers.authorization === `Bearer ${token}`;
  appendFileSync(`${dir}/requests.jsonl`, JSON.stringify({
    at: new Date().toISOString(), method: req.method, path: req.url, mode: current, authOk,
    contentType: req.headers["content-type"] ?? null, bodyKeys: body && typeof body === "object" ? Object.keys(body) : null,
    message: typeof body?.message === "string" ? body.message : null,
  }) + "\n");

  if (req.method !== "POST" || req.url !== "/chat") { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"not_found"}'); }
  if (!authOk) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}'); }
  if (typeof body?.message !== "string" || !body.message) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"message_required"}'); }

  switch (current) {
    case "http503": res.writeHead(503, { "Content-Type": "application/json" }); return res.end('{"error":"provider_down"}');
    case "http500": res.writeHead(500, { "Content-Type": "application/json" }); return res.end('{"error":"internal"}');
    case "unauthorized": res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"unauthorized"}');
    case "html": res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html>proxy error</html>");
    case "garbage": res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{not json");
    case "slow": await new Promise((r) => setTimeout(r, 40_000)); break;
    default: break;
  }
  if (res.destroyed) return;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ reply: JSON.stringify(answer(body.message)), model: "sim-gateway-model" }));
}).listen(port, "127.0.0.1", () => console.log(`SIM ONARLY AI gateway on 127.0.0.1:${port}`));
