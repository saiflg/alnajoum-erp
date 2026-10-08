#!/usr/bin/env node
/**
 * Sweeps every GET route of the API (taken from the controllers' source) as several users and scans the
 * responses for fields that must never leave the server: password hashes, TOTP secrets, token/recovery-code
 * hashes, stored ciphertext, and payout account numbers. LOCAL USE ONLY (read-only requests).
 *
 *   node scripts/security/secret-leak-sweep.mjs [--base URL]
 * Start the API with GLOBAL_THROTTLE_LIMIT raised.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : null) || 'http://localhost:4000/api/v1';
const SRC = new URL('../../src/modules', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = [/^\/auth\/(logout|refresh)/, /^\/backups?\b.*download/, /\/webhook/, /\/download$/, /\/file$/, /\/pdf$/, /\/id-card$/, /\/export/];
const USERS = [
  ['chidi.eze@demo.alnajoum.travel', 'Demo@2026'],
  ['ibrahim.musa@demo.alnajoum.travel', 'Demo@2026'],
  ['admin@alnajoum.travel', 'Alnajoum@2026'],
];

// field name -> predicate on the value that makes it a leak
const FORBIDDEN = {
  passwordHash: () => true,
  twoFactorSecret: (v) => v !== null,
  tokenHash: () => true,
  codeHash: () => true,
  twoFactorLastStep: () => true,
  bankAccountNumber: (v) => v !== null && v !== undefined,
};
const CIPHERTEXT = /enc:v1:[A-Za-z0-9_-]+:/;

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (f.endsWith('.controller.ts')) yield p;
  }
}
function inventory() {
  const routes = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    const ctl = /@Controller\(\s*(?:'([^']*)')?\s*\)/.exec(text);
    const prefix = ctl?.[1] ?? '';
    for (const m of text.matchAll(/@(Get)\(\s*(?:'([^']*)')?\s*\)/g)) {
      const path = ('/' + [prefix, m[2] ?? ''].filter(Boolean).join('/')).replace(/\/+/g, '/');
      routes.push(path.replace(/\/$/, '') || '/');
    }
  }
  return [...new Set(routes)].filter((p) => !SKIP.some((s) => s.test(p)));
}

async function login(email, password) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error('login failed for ' + email);
  return j.data.accessToken;
}

// Finance's verification screen must show the real number so it can be compared with the bank's records;
// it is permission-gated and the only list that does.
const ALLOWED = [/^\/finance\/staff-bank-accounts\/unverified :: .*bankAccountNumber$/];

function scan(value, path, out) {
  if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN[k] && FORBIDDEN[k](v)) out.push(`${path}.${k}`);
      else scan(v, `${path}.${k}`, out);
    }
  } else if (typeof value === 'string' && CIPHERTEXT.test(value)) out.push(`${path} (stored ciphertext)`);
}

const routes = inventory();
const findings = new Map();
let requests = 0;
for (const [email, password] of USERS) {
  const token = await login(email, password);
  const get = async (p) => {
    requests++;
    const r = await fetch(BASE + p, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 200) return null;
    return r.json().catch(() => null);
  };
  const ids = new Map(); // list path prefix -> ids
  const collect = (body) => {
    const data = body?.data;
    const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return rows.map((r) => r?.id).filter((x) => typeof x === 'string').slice(0, 3);
  };
  for (const p of routes.filter((r) => !r.includes(':'))) {
    const body = await get(p);
    if (!body) continue;
    ids.set(p, collect(body));
    const out = [];
    scan(body, '$', out);
    for (const o of out) if (!ALLOWED.some((a) => a.test(`${p} :: ${o.replace(/\[\d+\]/g, '')}`))) findings.set(`${p} :: ${o}`, email);
  }
  for (const p of routes.filter((r) => r.includes(':'))) {
    const prefix = p.slice(0, p.indexOf('/:')) || '/';
    for (const id of ids.get(prefix) ?? []) {
      const concrete = p.replace(/:[A-Za-z]+/g, id);
      const body = await get(concrete);
      if (!body) continue;
      const out = [];
      scan(body, '$', out);
      for (const o of out) findings.set(`${p} :: ${o}`, email);
    }
  }
}

console.log(`swept ${routes.length} GET routes as ${USERS.length} users (${requests} requests)`);
if (findings.size === 0) console.log('PASS  no secret-bearing field found in any response');
else {
  for (const [k, who] of findings) console.log(`LEAK  ${k}   (as ${who})`);
  console.log(`\n${findings.size} FINDING(S)`);
  process.exitCode = 1;
}
