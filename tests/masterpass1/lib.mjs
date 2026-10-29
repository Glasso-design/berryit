// MASTER PASS 1 — helpers for the REAL-stack tests. Only usable on the CI
// runner after stack-up.sh: every address is loopback on that runner.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";

const dir = process.env.MP1_DIR;
if (!dir || process.env.GITHUB_ACTIONS !== "true") throw new Error("MP1 tests run only on the throwaway CI runner");
export const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
export const G = fx.gateway;
export const WEB = fx.web;
export const email = (name) => `${name}@mp1.example.test`;
for (const [, url] of [["g", G], ["w", WEB]]) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("Non-loopback target refused");
}

/** psql as supabase_admin inside the throwaway db container; returns parsed JSON. */
export function sql(query) {
  const out = execFileSync("docker", ["exec", "-i", "berryit-support-db", "psql", "-v", "ON_ERROR_STOP=1", "-tA", "-U", "supabase_admin", "-d", "postgres"], { input: `select coalesce(json_agg(t), '[]'::json) from (${query}) t;`, encoding: "utf8" });
  return JSON.parse(out.trim() || "[]");
}
export function sqlExec(statement) {
  execFileSync("docker", ["exec", "-i", "berryit-support-db", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", "supabase_admin", "-d", "postgres"], { input: statement, encoding: "utf8" });
}

export const stub = {
  mode(value) { writeFileSync(`${dir}/stub/mode.txt`, value + "\n"); },
  requests() { return readFileSync(`${dir}/stub/requests.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); },
  container() { return execFileSync("docker", ["ps", "-aq", "--filter", "label=com.docker.compose.service=ai-gateway-stub"], { encoding: "utf8" }).trim(); },
  stop() { execFileSync("docker", ["stop", "-t", "1", this.container()]); },
  start() { execFileSync("docker", ["start", this.container()]); },

};

export async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { __raw: text.slice(0, 500) }; }
}

export async function login(name, password = fx.password) {
  const r = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: fx.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: email(name), password }) });
  const body = await json(r);
  return { status: r.status, token: body.access_token, refresh: body.refresh_token, body };
}

function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = ""; for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

/** Password login + TOTP enrolment + verify through GoTrue: returns an aal2 token. */
export async function loginAal2(name) {
  const first = await login(name);
  const auth = { apikey: fx.anonKey, Authorization: `Bearer ${first.token}`, "Content-Type": "application/json" };
  const factor = await json(await fetch(`${G}/auth/v1/factors`, { method: "POST", headers: auth, body: JSON.stringify({ factor_type: "totp", friendly_name: "mp1-" + name }) }));
  const challenge = await json(await fetch(`${G}/auth/v1/factors/${factor.id}/challenge`, { method: "POST", headers: auth, body: "{}" }));
  const verify = await fetch(`${G}/auth/v1/factors/${factor.id}/verify`, { method: "POST", headers: auth, body: JSON.stringify({ challenge_id: challenge.id, code: totp(factor.totp.secret) }) });
  const verified = await json(verify);
  if (!verified.access_token) throw new Error("MFA verify failed: " + verify.status + " " + JSON.stringify(verified).slice(0, 300));
  return { aal1: first.token, token: verified.access_token, secret: factor.totp.secret };
}

export const rest = (token, path, init = {}) => fetch(`${G}/rest/v1${path}`, { ...init, headers: { apikey: fx.anonKey, Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
export const ai = (token, path, init = {}) => fetch(`${G}/ai/v1${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
/** Desktop-style call to the Next.js route handler: Bearer, no Origin header. */
export const route = (token, action, args = {}, path = "/api/control/support") => fetch(`${WEB}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(path === "/api/control/support" ? { action, args } : args) });

export function evidence(line) { appendFileSync(`${dir}/evidence.log`, line + "\n"); }
