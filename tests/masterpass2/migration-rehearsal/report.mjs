#!/usr/bin/env node
// MASTER PASS 1 CI reporter.
//
//   node scripts/ci/masterpass1/report.mjs "<title>" -- <command> [args...]
//
// Runs the command, streams its output unchanged, and turns the result into
// GitHub check-run annotations, because the people reviewing this pass can read
// annotations but not raw logs. It never prints environment variables, and it
// drops any line that looks like it carries a credential.
//
// One ::notice summarises the run (exit code, node:test counts, PASS/FAIL gate
// lines); up to MAX_ERRORS ::error annotations carry the most informative
// failure excerpts. The exit code of the command is preserved.
import { spawn } from 'node:child_process';

const MAX_ERRORS = 8;
const MAX_CHARS = 3500;
// Drop lines that carry what looks like a credential VALUE (a JWT, a Supabase key, a URL with a password, a bearer
// value, or key=value / key: value for secret-like keys). Test names that merely mention "password" stay.
const SECRETISH = /(eyJ[A-Za-z0-9_-]{10,}|sb_(publishable|secret)_[A-Za-z0-9]|postgres(ql)?:\/\/\S*@|bearer\s+[A-Za-z0-9._~+\/-]{16,}|(api[_-]?key|secret|password|passwd|token|jwt|authorization)["']?\s*[=:]\s*["']?[A-Za-z0-9._~+\/-]{12,})/i;

const sep = process.argv.indexOf('--');
const title = process.argv[2];
const command = sep > 0 ? process.argv.slice(sep + 1) : [];
if (!title || command.length === 0) {
  console.error('usage: report.mjs "<title>" -- <command> [args...]');
  process.exit(2);
}

const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const escapeProp = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
const clean = (text) => text.split('\n').filter((line) => !SECRETISH.test(line)).join('\n');
const clip = (text) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(truncated)` : text);
// Strip ANSI colour codes so annotations stay readable.
const plain = (text) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

let output = '';
const started = Date.now();
const child = spawn(command[0], command.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
child.stdout.on('data', (chunk) => { process.stdout.write(chunk); output += chunk; });
child.stderr.on('data', (chunk) => { process.stderr.write(chunk); output += chunk; });

child.on('close', (code, signal) => {
  const text = plain(output);
  const lines = text.split('\n');
  const seconds = Math.round((Date.now() - started) / 1000);
  const sum = (label) => {
    const matches = [...text.matchAll(new RegExp(`^(?:ℹ|#) ${label} (\\d+)`, 'gm'))];
    return matches.length ? matches.reduce((total, match) => total + Number(match[1]), 0) : null;
  };
  const counts = ['tests', 'pass', 'fail', 'skipped', 'todo', 'cancelled']
    .map((label) => [label, sum(label)])
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `${label}=${value}`)
    .join(' ');
  // Summary lines that runners in this repo print (run-suites, run-browser-gates, e2e scripts).
  const summary = lines
    .filter((line) => /^(PASS|FAIL)\s|gates passed|suites passed|^\s*(✓|✔|ok \d+|not ok \d+)|checks? passed|passed:|failed:/i.test(line.trim()))
    .slice(-60)
    .join('\n');
  const status = code === 0 ? 'OK' : `EXIT ${code ?? signal}`;
  const notice = clip(clean(`${status} in ${seconds}s${counts ? ` · ${counts}` : ''}\n${summary}`));
  console.log(`::notice title=${escapeProp(`${title} · ${status}`)}::${escapeData(notice)}`);

  if (code !== 0) {
    // Failure excerpts: each "not ok"/FAIL/Error line with the lines that follow it.
    const excerpts = [];
    const seen = new Set();
    for (let index = 0; index < lines.length && excerpts.length < MAX_ERRORS; index += 1) {
      const line = lines[index];
      if (!/(^\s*not ok\b|^\s*FAIL\b|✖|AssertionError|Error:|error TS\d+|^\s*\d+:\d+\s+error\b|ERR_|Timeout|timed out|failed)/i.test(line)) continue;
      const block = clean(lines.slice(Math.max(0, index - 2), index + 28).join('\n')).trim();
      const key = block.slice(0, 200);
      if (!block || seen.has(key)) continue;
      seen.add(key);
      excerpts.push(block);
      index += 20;
    }
    if (excerpts.length === 0) excerpts.push(clean(lines.slice(-40).join('\n')).trim() || `${title} exited ${code ?? signal} with no output`);
    excerpts.forEach((block, i) => {
      console.log(`::error title=${escapeProp(`${title} · failure ${i + 1}/${excerpts.length}`)}::${escapeData(clip(block))}`);
    });
  }
  process.exit(code ?? 1);
});
