// Unit tests for scripts/preview-guard.mjs (pure decision logic, no network).
// The real `npm run build` cases run in .github/workflows/masterpass1-berryit.yml (job preview-guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate, run, classifyKey, matchesProductionHost, productionDataHosts, readEnvFiles, MARKER } from './preview-guard.mjs';

const jwt = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'c2ln'].join('.');
const SERVICE = jwt({ role: 'service_role', iss: 'supabase' });
const SERVICE_PROD_REF = jwt({ role: 'service_role', iss: 'supabase', ref: 'prodref123' });
const ANON = jwt({ role: 'anon', iss: 'supabase' });
const ISOLATED = 'https://berryit-preview.isolated-ci.net';
const errors = (env) => evaluate(env).lines.filter((l) => l.level === 'error').map((l) => l.text);

test('not a Preview: production URL builds; only the browser-secret rule applies', () => {
  assert.equal(evaluate({ NEXT_PUBLIC_SUPABASE_URL: 'https://portal.berryit.se', SUPABASE_SERVICE_ROLE_KEY: SERVICE }).ok, true);
  assert.equal(evaluate({ VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://portal.berryit.se', SUPABASE_SERVICE_ROLE_KEY: SERVICE }).ok, true);
});

test('a secret in a NEXT_PUBLIC_ variable is refused everywhere', () => {
  for (const vercel of [undefined, 'production', 'preview', 'development']) {
    assert.match(errors({ VERCEL_ENV: vercel, NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE }).join(' '), /NEXT_PUBLIC_SUPABASE_ANON_KEY holds a service-role/);
    assert.match(errors({ VERCEL_ENV: vercel, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_abc' }).join(' '), /secret credential/);
    assert.match(errors({ VERCEL_ENV: vercel, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'anything' }).join(' '), /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  }
  assert.equal(evaluate({ NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON }).ok, true);
  assert.equal(evaluate({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x' }).ok, true);
});

test('Preview pointed at a documented production host is refused', () => {
  for (const url of ['https://portal.berryit.se', 'https://PORTAL.berryit.se./', 'http://prod-node-01:8700', 'http://prod-node-01.tail1234.ts.net:8700', 'http://100.100.11.6:8700', 'https://x.portal.berryit.se']) {
    const e = errors({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/x', NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON });
    assert.match(e.join(' '), /Preview build of feature\/x points at production data: NEXT_PUBLIC_SUPABASE_URL -> /, url);
  }
  // any data variable, not only the Supabase URL
  assert.match(errors({ VERCEL_ENV: 'preview', SUPABASE_URL: 'https://portal.berryit.se' }).join(' '), /SUPABASE_URL -> portal\.berryit\.se/);
});

test('BERRYIT_PRODUCTION_DATA_HOSTS adds hosts (bare, with scheme, subdomains match)', () => {
  const env = { VERCEL_ENV: 'preview', BERRYIT_PRODUCTION_DATA_HOSTS: ' https://prodref123.supabase.co/ , other.example.org', NEXT_PUBLIC_SUPABASE_URL: 'https://prodref123.supabase.co' };
  assert.deepEqual(productionDataHosts(env).slice(-2), ['prodref123.supabase.co', 'other.example.org']);
  assert.match(errors(env).join(' '), /NEXT_PUBLIC_SUPABASE_URL -> prodref123\.supabase\.co/);
  assert.match(errors({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://api.other.example.org' }).join(' '), /api\.other\.example\.org/);
});

test('host matching does not over-match', () => {
  const hosts = productionDataHosts({});
  assert.equal(matchesProductionHost('notportal.berryit.se', hosts), null);
  assert.equal(matchesProductionHost('prod-node-010', hosts), null);
  assert.equal(matchesProductionHost('prod-node-01x.example.net', hosts), null);
  assert.equal(matchesProductionHost('100.100.11.60', hosts), null);
  assert.equal(matchesProductionHost('berryit.se', hosts), null, 'the public website is not a data host');
});

test('service-role key in a Preview needs the explicit marker naming the backend host', () => {
  const base = { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: ISOLATED, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE };
  assert.match(errors(base).join(' '), new RegExp(`has SUPABASE_SERVICE_ROLE_KEY .* but no ${MARKER}`));
  assert.match(errors({ ...base, [MARKER]: 'other.isolated-ci.net' }).join(' '), /names other\.isolated-ci\.net but NEXT_PUBLIC_SUPABASE_URL is on berryit-preview\.isolated-ci\.net/);
  assert.match(errors({ ...base, [MARKER]: 'true' }).join(' '), /names true but/);
  assert.equal(evaluate({ ...base, [MARKER]: 'berryit-preview.isolated-ci.net' }).ok, true);
  assert.equal(evaluate({ ...base, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', [MARKER]: 'Berryit-Preview.isolated-ci.net' }).ok, true);
  // marker cannot whitelist production
  const prod = { ...base, NEXT_PUBLIC_SUPABASE_URL: 'https://portal.berryit.se', [MARKER]: 'portal.berryit.se' };
  assert.equal(evaluate(prod).ok, false);
  // a hosted service-role key of a listed production project is refused even with a marker
  assert.match(errors({ ...base, SUPABASE_SERVICE_ROLE_KEY: SERVICE_PROD_REF, BERRYIT_PRODUCTION_DATA_HOSTS: 'prodref123.supabase.co', [MARKER]: 'berryit-preview.isolated-ci.net' }).join(' '), /belongs to the production project prodref123\.supabase\.co/);
});

test('isolated Preview without a service-role key builds (with a warning to keep the backend non-production)', () => {
  const result = evaluate({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: ISOLATED, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON });
  assert.equal(result.ok, true);
  assert.ok(result.lines.some((l) => l.level === 'warn'));
  assert.equal(evaluate({ VERCEL_ENV: 'preview' }).ok, true, 'a Preview without any backend builds');
});

test('classifyKey never needs the key value and reads hosted refs', () => {
  assert.deepEqual(classifyKey(SERVICE_PROD_REF), { kind: 'service_role', secret: true, ref: 'prodref123' });
  assert.equal(classifyKey('').kind, 'missing');
  assert.equal(classifyKey('garbage').kind, 'unknown');
});

test('env files are read like next build does; process env wins; output never contains a key value', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'preview-guard-'));
  try {
    writeFileSync(path.join(dir, '.env'), 'NEXT_PUBLIC_SUPABASE_URL=https://berryit-preview.isolated-ci.net\n');
    writeFileSync(path.join(dir, '.env.production.local'), `# comment\nexport NEXT_PUBLIC_SUPABASE_URL="https://portal.berryit.se" # prod\nSUPABASE_SERVICE_ROLE_KEY='${SERVICE}'\n`);
    assert.equal(readEnvFiles(dir).NEXT_PUBLIC_SUPABASE_URL, 'https://portal.berryit.se');
    const out = [];
    const code = run({ env: { VERCEL_ENV: 'preview' }, cwd: dir, log: (l) => out.push(l), logError: (l) => out.push(l) });
    assert.equal(code, 1);
    assert.match(out.join('\n'), /points at production data/);
    assert.ok(!out.join('\n').includes(SERVICE), 'the key value is never printed');
    const code2 = run({ env: { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: ISOLATED, SUPABASE_SERVICE_ROLE_KEY: '', [MARKER]: '' }, cwd: dir, log: () => {}, logError: () => {} });
    assert.equal(code2, 0, 'process env overrides the files');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
