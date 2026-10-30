#!/usr/bin/env node
// BERRYiT build guard (MASTER PASS 3, 2026-10-30). Run by `npm run build`, the
// build Vercel executes (vercel.json "buildCommand"), before `next build`.
//
// A Vercel *Preview* is built from an unreviewed branch and is reachable by
// anyone with its URL. Its server code reads SUPABASE_SERVICE_ROLE_KEY (full
// database access) and its pages talk to NEXT_PUBLIC_SUPABASE_URL. The guard
// therefore REFUSES to build when
//   * anywhere: a NEXT_PUBLIC_* variable holds a service-role/secret
//     credential (Next.js copies NEXT_PUBLIC_* into the browser bundle);
//   * VERCEL_ENV=preview: a NEXT_PUBLIC_* or SUPABASE_* variable points at a
//     production data host (PRODUCTION_DATA_HOSTS below, from the deploy docs,
//     plus BERRYIT_PRODUCTION_DATA_HOSTS, comma separated; subdomains match);
//   * VERCEL_ENV=preview: SUPABASE_SERVICE_ROLE_KEY is present without the
//     explicit isolated-backend marker BERRYIT_PREVIEW_ISOLATED_BACKEND, which
//     must name exactly the host of NEXT_PUBLIC_SUPABASE_URL (a deliberate
//     statement that this Preview has its own throwaway backend);
//   * VERCEL_ENV=preview: the service-role key itself names a production
//     project (hosted Supabase JWT "ref" -> <ref>.supabase.co in the list).
// Production and local/CI builds are not restricted beyond the first rule.
//
// Output names variables and hosts, never a key, token or password value.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Hosts that serve BERRYiT production data, as documented in the repo:
 *   portal.berryit.se  - the Support Desk stack's public base URL
 *                        (deploy/berryit-support/generate-secrets.sh, supabase/README.md)
 *   prod-node-01       - the production server (deploy/berryit-support/README.md);
 *                        a single label also matches its MagicDNS names (prod-node-01.<tailnet>.ts.net)
 *   100.100.11.6       - prod-node-01's tailnet address (desktop/README.md)
 * The owner adds the production Supabase host of the Vercel project (if any)
 * through BERRYIT_PRODUCTION_DATA_HOSTS without a code change.
 */
export const PRODUCTION_DATA_HOSTS = ['portal.berryit.se', 'prod-node-01', '100.100.11.6'];
export const MARKER = 'BERRYIT_PREVIEW_ISOLATED_BACKEND';

const normalizeHost = (value) => String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

export function productionDataHosts(env = {}) {
  const extra = String(env.BERRYIT_PRODUCTION_DATA_HOSTS ?? '').split(',').map((entry) => {
    const text = entry.trim();
    if (!text) return '';
    try { return normalizeHost(new URL(text.includes('://') ? text : `https://${text}`).hostname); } catch { return normalizeHost(text); }
  }).filter(Boolean);
  return [...new Set([...PRODUCTION_DATA_HOSTS, ...extra])];
}

export function matchesProductionHost(host, hosts) {
  const h = normalizeHost(host);
  return hosts.find((p) => h === p || h.endsWith(`.${p}`) || (!p.includes('.') && h.startsWith(`${p}.`))) ?? null;
}

const URL_IN_TEXT = /\b(?:https?|wss?|postgres(?:ql)?):\/\/[^\s"'`,\]}]+/gi;
const DATA_VARIABLE = /^(NEXT_PUBLIC_|SUPABASE_|BERRYIT_PUBLIC_)/;

/** Data variables that point at a production host, as {name, host}. Values are never returned. */
export function productionDataReferences(env = {}, hosts = productionDataHosts(env)) {
  const found = [];
  for (const [name, raw] of Object.entries(env)) {
    if (!DATA_VARIABLE.test(name) || name === 'BERRYIT_PRODUCTION_DATA_HOSTS') continue;
    for (const candidate of String(raw ?? '').match(URL_IN_TEXT) ?? []) {
      let host;
      try { host = new URL(candidate).hostname; } catch { continue; }
      const match = matchesProductionHost(host, hosts);
      if (match) { found.push({ name, host: normalizeHost(host) }); break; }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** What kind of Supabase key a value is. Never returns the key. */
export function classifyKey(raw) {
  const key = String(raw ?? '').trim();
  if (!key) return { kind: 'missing', secret: false, ref: null };
  if (key.startsWith('sb_secret_')) return { kind: 'secret', secret: true, ref: null };
  if (key.startsWith('sb_publishable_')) return { kind: 'publishable', secret: false, ref: null };
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const ref = typeof claims?.ref === 'string' && /^[a-z0-9-]{3,64}$/i.test(claims.ref) ? claims.ref.toLowerCase() : null;
      if (claims?.role === 'service_role') return { kind: 'service_role', secret: true, ref };
      if (claims?.role === 'anon') return { kind: 'anon', secret: false, ref };
      return { kind: 'jwt', secret: false, ref };
    } catch { /* not a JWT */ }
  }
  return { kind: 'unknown', secret: false, ref: null };
}

const SECRET_PUBLIC_NAME = /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD)/i;

/**
 * Values Next.js itself loads for `next build` (NODE_ENV=production), so a
 * committed or generated env file cannot slip past the guard. Variables in the
 * process environment win, then .env.production.local, .env.local,
 * .env.production, .env (Next.js order).
 */
export function readEnvFiles(cwd = process.cwd(), read = (file) => readFileSync(file, 'utf8')) {
  const values = {};
  for (const file of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    let text;
    try { text = read(path.join(cwd, file)); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const quoted = /^(['"`])(.*?)\1(?:\s+#.*)?$/.exec(match[2]);
      values[match[1]] = quoted ? quoted[2] : match[2].replace(/\s+#.*$/, '');
    }
  }
  return values;
}

/** The decision. Pure: returns {ok, lines:[{level,text}]}. */
export function evaluate(env = {}) {
  const lines = [];
  const add = (level, text) => lines.push({ level, text });
  const vercelEnv = String(env.VERCEL_ENV ?? '').trim();
  const branch = String(env.VERCEL_GIT_COMMIT_REF ?? '').trim();

  // 1. Secrets in the browser bundle are fatal everywhere.
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('NEXT_PUBLIC_') || !String(raw ?? '').trim()) continue;
    if (SECRET_PUBLIC_NAME.test(name) || classifyKey(raw).secret) {
      add('error', `${name} holds a service-role/secret credential and would be copied into the public browser bundle. Only the anon/publishable key may use a NEXT_PUBLIC_ name.`);
    }
  }

  if (vercelEnv === 'preview') {
    const hosts = productionDataHosts(env);
    const where = `Preview build${branch ? ` of ${branch}` : ''}`;
    // 2. No production data host in a Preview.
    const references = productionDataReferences(env, hosts);
    if (references.length) {
      add('error', `${where} points at production data: ${references.map(({ name, host }) => `${name} -> ${host}`).join(', ')}. Previews must use an isolated backend or none. Set Preview-scoped NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel (deploy/berryit-support/README.md, "Vercel Preview").`);
    } else {
      add('info', `preview isolation: no data variable points at a production host (${hosts.length} hosts checked).`);
    }
    // 3. A service-role key in a Preview needs an explicit, matching isolated-backend marker.
    const service = classifyKey(env.SUPABASE_SERVICE_ROLE_KEY);
    if (service.kind !== 'missing') {
      let urlHost = '';
      try { urlHost = normalizeHost(new URL(String(env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()).hostname); } catch { urlHost = ''; }
      const marker = normalizeHost(env[MARKER]);
      if (service.ref && matchesProductionHost(`${service.ref}.supabase.co`, hosts)) {
        add('error', `${where}: SUPABASE_SERVICE_ROLE_KEY belongs to the production project ${service.ref}.supabase.co. Remove it from the Preview environment in Vercel.`);
      } else if (!marker) {
        add('error', `${where} has SUPABASE_SERVICE_ROLE_KEY (full database access) but no ${MARKER}. A Preview runs unreviewed server code: remove the key from the Preview environment in Vercel, or give the Preview its own throwaway backend and set ${MARKER} to that backend's host.`);
      } else if (!urlHost || marker !== urlHost) {
        add('error', `${where}: ${MARKER} names ${marker} but NEXT_PUBLIC_SUPABASE_URL ${urlHost ? `is on ${urlHost}` : 'is missing or invalid'}. The marker must name the Preview's own backend host.`);
      } else if (matchesProductionHost(urlHost, hosts)) {
        add('error', `${where}: ${MARKER} names a production host (${urlHost}).`);
      } else {
        add('info', `preview isolation: service-role key accepted for the declared isolated backend ${urlHost}.`);
      }
    } else {
      add('info', 'preview isolation: no SUPABASE_SERVICE_ROLE_KEY in this Preview (server-side registration answers "not configured").');
    }
    if (String(env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim() && !String(env[MARKER] ?? '').trim()) {
      add('warn', `preview isolation: NEXT_PUBLIC_SUPABASE_URL is set but ${MARKER} is not; make sure that backend is not production (add its host to BERRYIT_PRODUCTION_DATA_HOSTS if it is).`);
    }
  } else {
    add('info', `preview isolation: not a Vercel Preview build (VERCEL_ENV=${vercelEnv || 'unset'}); only the browser-bundle secret check applies.`);
  }
  return { ok: !lines.some((line) => line.level === 'error'), lines };
}

export function run({ env = process.env, cwd = process.cwd(), log = console.log, logError = console.error } = {}) {
  const merged = { ...readEnvFiles(cwd), ...env };
  const result = evaluate(merged);
  for (const { level, text } of result.lines) (level === 'error' ? logError : log)(`${level.toUpperCase()} ${text}`);
  if (!result.ok) logError('ERROR build refused by scripts/preview-guard.mjs (nothing was built).');
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = run();
}
