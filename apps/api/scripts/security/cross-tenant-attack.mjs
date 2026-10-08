#!/usr/bin/env node
/**
 * Cross-tenant attack harness (Phase 22). LOCAL USE ONLY — it mutates data.
 *
 * Logs in as an administrator of company B (the "victim") and one of company A (the "attacker"),
 * collects ids that belong to the victim by listing as the victim, then replays EVERY route in the
 * API (taken from the controllers' source) as the attacker with the victim's ids.
 *
 * For each (route, ids) the victim ("owner") is asked first. Only when the owner could reach the
 * object (status is not 401/403/404) is the attacker's answer meaningful:
 *   404 / 403 / 401   -> contained
 *   400 / 422         -> inconclusive (rejected before the object was looked up, e.g. validation)
 *   2xx               -> LEAK (GET) or CROSS-TENANT WRITE (anything else)
 *   409 and other 4xx -> SUSPECT: the service reached the victim's object before refusing
 *
 * Usage:  node scripts/security/cross-tenant-attack.mjs [--base http://localhost:4000/api/v1]
 *            [--victim email:password] [--attacker email:password] [--out report.json] [--reads-only]
 * Start the API with GLOBAL_THROTTLE_LIMIT and AUTH_THROTTLE_LIMIT raised, or it will rate-limit itself.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = args.base || 'http://localhost:4000/api/v1';
const [VICTIM_EMAIL, VICTIM_PASS] = (args.victim || 'chidi.eze@demo.alnajoum.travel:Demo@2026').split(/:(.*)/s);
const [ATTACKER_EMAIL, ATTACKER_PASS] = (args.attacker || 'admin@zamzamhorizon.demo.alnajoum.travel:Demo@2026').split(/:(.*)/s);
const READS_ONLY = Boolean(args['reads-only']);
const SRC = new URL('../../src/modules', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = [/^\/auth\//, /^\/backups?\b/, /^\/data\//, /\/webhook/, /^\/payments\/paystack/];

// ---------------------------------------------------------------- route inventory
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
    const src = readFileSync(file, 'utf8');
    const pre = /@Controller\(\s*(?:['"]([^'"]*)['"])?\s*\)/.exec(src);
    if (!pre) continue;
    const prefix = pre[1] || '';
    const re = /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const path = '/' + [prefix, m[2] || ''].filter(Boolean).join('/').replace(/\/+/g, '/');
      routes.push({ method: m[1].toUpperCase(), path: path.replace(/\/$/, '') || '/', file: file.split('modules')[1] });
    }
  }
  const seen = new Set();
  return routes.filter((r) => !seen.has(r.method + r.path) && seen.add(r.method + r.path));
}

// ---------------------------------------------------------------- http

// Sensitive routes (wallet credit, role changes, payouts...) need a fresh proof of identity on top of the
// session. The harness obtains one per user and sends it on every request; routes that do not ask for it ignore it.
const stepUpTokens = new Map();
async function obtainStepUp(base, accessToken, password) {
  const r = await fetch(base + '/security/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ password }),
  });
  const j = await r.json().catch(() => ({}));
  const t = (j.data ?? j).stepUpToken;
  if (t) stepUpTokens.set(accessToken, t);
}
async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(stepUpTokens.has(token) ? { 'x-step-up-token': stepUpTokens.get(token) } : {}),
      ...(method !== 'GET' && method !== 'DELETE' ? { 'content-type': 'application/json' } : {}),
    },
    body: method !== 'GET' && method !== 'DELETE' ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  }).catch((e) => ({ status: 0, text: async () => String(e) }));
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}
async function login(email, password) {
  const r = await call('', 'POST', '/auth/login', { email, password });
  const data = r.json?.data ?? r.json;
  const token = data?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${r.status} ${r.text.slice(0, 200)}`);
  return token;
}

// ---------------------------------------------------------------- victim id pool
const ID_RE = /^c[a-z0-9]{20,30}$/; // cuid
function collectIds(node, tag, out, depth = 0) {
  if (depth > 5 || node == null) return;
  if (Array.isArray(node)) { node.slice(0, 40).forEach((n) => collectIds(n, tag, out, depth + 1)); return; }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && ID_RE.test(v) && (k === 'id' || k.endsWith('Id'))) out.push({ id: v, tag, field: k });
      else collectIds(v, tag, out, depth + 1);
    }
  }
}

function stem(param) {
  return param.replace(/Id$/, '').replace(/^id$/, '').toLowerCase();
}

const routes = inventory().filter((r) => !SKIP.some((s) => s.test(r.path)));
console.log(`route inventory: ${routes.length} routes`);

const victimToken = await login(VICTIM_EMAIL, VICTIM_PASS);
const attackerToken = await login(ATTACKER_EMAIL, ATTACKER_PASS);
await obtainStepUp(BASE, victimToken, VICTIM_PASS);
await obtainStepUp(BASE, attackerToken, ATTACKER_PASS);

const pool = [];
for (const r of routes.filter((x) => x.method === 'GET' && !x.path.includes(':'))) {
  const res = await call(victimToken, 'GET', r.path);
  if (res.status === 200) collectIds(res.json?.data ?? res.json, r.path, pool);
}
const byId = new Map();
for (const p of pool) if (!byId.has(p.id)) byId.set(p.id, p);
const ids = [...byId.values()];
console.log(`victim ids collected: ${ids.length} (from ${new Set(ids.map((i) => i.tag)).size} list endpoints)`);

// ---------------------------------------------------------------- attack
const PER_ROUTE = Number(args['per-route'] || 18);
const findings = [];
let tested = 0;

function commonPrefix(a, b) {
  const x = a.split('/').filter(Boolean);
  const y = b.split('/').filter(Boolean);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n] && !y[n].startsWith(':')) n++;
  return n;
}

function candidatesFor(route, params) {
  // Rank victim ids by how closely the list endpoint they came from matches this route's path
  // (e.g. ids listed at /flights/bookings for /flights/bookings/:id/cancel), then by param-name stem.
  const s = stem(params[0]);
  const score = (i) =>
    commonPrefix(i.tag, route.path) * 10 +
    (s && (i.tag.toLowerCase().includes(s) || i.field.toLowerCase().startsWith(s)) ? 5 : 0);
  const sorted = [...ids].sort((a, b) => score(b) - score(a));
  const topScore = score(sorted[0] || { tag: '', field: '' });
  const out = []; const seenTag = new Map();
  for (const i of sorted) {
    const n = seenTag.get(i.tag) || 0;
    const cap = score(i) >= topScore - 5 ? PER_ROUTE : 2; // best-matching lists can fill the quota
    if (n >= cap) continue;
    seenTag.set(i.tag, n + 1);
    out.push(i);
    if (out.length >= PER_ROUTE) break;
  }
  return out;
}

for (const route of routes.filter((r) => r.path.includes(':'))) {
  if (READS_ONLY && route.method !== 'GET') continue;
  const params = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
  for (const cand of candidatesFor(route, params)) {
    const path = route.path.replace(/:(\w+)/g, (_, p) => (p === params[0] ? cand.id : candidateForOther(p, cand)));
    function candidateForOther(p, c) {
      const s = stem(p);
      const hit = ids.find((i) => s && (i.tag.toLowerCase().includes(s) || i.field.toLowerCase().startsWith(s)));
      return (hit || c).id;
    }
    // Attacker first: if the object is correctly hidden (404/403/401) or the request is rejected
    // before any lookup (400/422/429) nothing more needs asking. Only when the attacker got past
    // that is the owner asked, to confirm the id really belongs to this route's resource type.
    const attacker = await call(attackerToken, route.method, path);
    if ([0, 400, 401, 403, 404, 422, 429].includes(attacker.status) || attacker.status >= 500) continue;
    const owner = await call(victimToken, route.method, path);
    if ([401, 403, 404, 0].includes(owner.status) || owner.status >= 500) continue; // wrong resource type for this id
    tested++;
    const s = attacker.status;
    let verdict = null;
    if (s >= 200 && s < 300) {
      // An empty list proves nothing was exposed *here*, but it also proves nothing was checked:
      // the route answered 200 for another tenant's id instead of 404. Reported separately.
      const d = attacker.json?.data ?? attacker.json;
      const empty = d == null || (Array.isArray(d) && d.length === 0) || (typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 0);
      verdict = route.method === 'GET' ? (empty ? 'UNGUARDED-EMPTY' : 'LEAK') : 'CROSS-TENANT WRITE';
    }
    else if (s === 409 || (s >= 400 && s < 500 && ![400, 401, 403, 404, 422, 429].includes(s))) verdict = 'SUSPECT';
    if (verdict) {
      findings.push({
        verdict, method: route.method, route: route.path, file: route.file, id: cand.id, idFrom: cand.tag,
        ownerStatus: owner.status, attackerStatus: s, snippet: attacker.text.slice(0, 160),
      });
    }
  }
}

// ---------------------------------------------------------------- list overlap
// Lists carry no id to guess, so the question is different: does the attacker's list contain
// records the victim's list also contains? Identical records visible to both tenants are either a
// deliberately shared catalog or a missing tenant filter; a human decides which, per route.
const victimIdsByRoute = new Map();
for (const p of pool) {
  if (!victimIdsByRoute.has(p.tag)) victimIdsByRoute.set(p.tag, new Set());
  victimIdsByRoute.get(p.tag).add(p.id);
}
const overlaps = [];
for (const r of routes.filter((x) => x.method === 'GET' && !x.path.includes(':'))) {
  const mine = victimIdsByRoute.get(r.path);
  if (!mine || mine.size === 0) continue;
  const res = await call(attackerToken, 'GET', r.path);
  if (res.status !== 200) continue;
  const got = [];
  collectIds(res.json?.data ?? res.json, r.path, got);
  const shared = [...new Set(got.map((g) => g.id))].filter((id) => mine.has(id));
  if (shared.length) overlaps.push({ route: r.path, victimIds: mine.size, attackerIds: new Set(got.map((g) => g.id)).size, shared: shared.length });
}
if (overlaps.length) {
  console.log('\nLIST OVERLAP (records visible to BOTH tenants - shared catalog or missing tenant filter):');
  for (const o of overlaps.sort((a, b) => b.shared - a.shared)) {
    console.log(`  ${o.route.padEnd(48)} victim ${String(o.victimIds).padStart(4)} | attacker ${String(o.attackerIds).padStart(4)} | shared ${o.shared}`);
  }
}

findings.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.route.localeCompare(b.route));
const summary = {};
for (const f of findings) summary[f.verdict] = (summary[f.verdict] || 0) + 1;
console.log(`\nmeaningful attacker attempts: ${tested}`);
console.log('findings:', JSON.stringify(summary));
const seenKeys = new Set();
for (const f of findings) {
  const key = `${f.verdict} ${f.method} ${f.route}`;
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);
  console.log(`${f.verdict.padEnd(18)} ${f.method.padEnd(6)} ${f.route}   [owner ${f.ownerStatus} / attacker ${f.attackerStatus}]  ${f.snippet.replace(/\s+/g, ' ').slice(0, 90)}`);
}
if (args.out) writeFileSync(args.out, JSON.stringify({ tested, summary, findings, overlaps }, null, 2));
process.exitCode = findings.some((f) => f.verdict === 'LEAK' || f.verdict === 'CROSS-TENANT WRITE') ? 1 : 0;
