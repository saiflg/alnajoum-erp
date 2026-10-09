#!/usr/bin/env node
/**
 * Load and latency check against a RUNNING local API (LOCAL USE ONLY; read-mostly, mock providers).
 *
 *   node scripts/certification/load-check.mjs [--seconds 20] [--users 20]
 *
 * Start the API with GLOBAL_THROTTLE_LIMIT / AUTH_THROTTLE_LIMIT raised (otherwise the rate limiter - which is
 * correct behaviour - rejects the load). For each scenario, `users` virtual users loop for `seconds` and every
 * response time is recorded. Thresholds are deliberately modest, because this runs on a developer laptop with the
 * database, the API and this script sharing one machine: a pass means "no errors and no pathological latency
 * here", NOT a capacity statement for a production server. Real capacity needs a production-like host and a
 * production-sized database.
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const SECONDS = Number(args.seconds || 20);
const USERS = Number(args.users || 20);
const DEMO = 'Demo@2026';

async function login(email) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: DEMO }) });
  const j = await r.json();
  const t = (j.data ?? j).accessToken;
  if (!t) throw new Error('login failed ' + email);
  return t;
}
const admin = await login('chidi.eze@demo.alnajoum.travel');
const finance = await login('ibrahim.musa@demo.alnajoum.travel');
const customer = await login('chinedu.okafor@demo.alnajoum.travel');

const SEARCH = { tripType: 'ONE_WAY', cabinClass: 'ECONOMY', adults: 1, segments: [{ origin: 'LOS', destination: 'ABV', departureDate: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10) }] };

// name, method, path, token, body, p95 budget (ms)
const scenarios = [
  ['health', 'GET', '/health', null, null, 300],
  ['admin: invoice list', 'GET', '/invoices', admin, null, 1500],
  ['admin: customer list', 'GET', '/customers', admin, null, 1500],
  ['admin: dashboard KPIs', 'GET', '/dashboard/kpis', admin, null, 2500],
  ['admin: executive analytics overview', 'GET', '/analytics/overview', admin, null, 3000],
  ['finance: journal entries', 'GET', '/finance/accounts/journal-entries', finance, null, 2000],
  ['customer: own invoices', 'GET', '/invoices/me', customer, null, 1500],
  ['customer: own wallet', 'GET', '/wallet/me', customer, null, 1500],
  ['public: flight search (mock provider)', 'POST', '/flights/search', null, SEARCH, 2500],
  ['AI assistant: balance question', 'POST', '/ai/assistant/message', customer, { content: 'How much do I owe?' }, 4000],
];

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
let failed = 0;
console.log(`${USERS} virtual users x ${SECONDS}s per scenario\n`);
console.log('scenario'.padEnd(40), 'reqs'.padStart(6), 'rps'.padStart(6), 'err'.padStart(5), 'p50'.padStart(6), 'p95'.padStart(6), 'p99'.padStart(6), 'budget'.padStart(7), ' result');

for (const [name, method, path, token, body, budget] of scenarios) {
  const times = [];
  let errors = 0;
  const statuses = new Map();
  const deadline = Date.now() + SECONDS * 1000;
  async function user() {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const res = await fetch(BASE + path, {
          method,
          headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        await res.arrayBuffer();
        statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
        if (res.status >= 400) errors++;
      } catch {
        errors++;
      }
      times.push(performance.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: USERS }, user));
  times.sort((a, b) => a - b);
  const p50 = pct(times, 50), p95 = pct(times, 95), p99 = pct(times, 99);
  const pass = errors === 0 && p95 <= budget;
  if (!pass) failed++;
  console.log(
    name.padEnd(40), String(times.length).padStart(6), (times.length / SECONDS).toFixed(0).padStart(6), String(errors).padStart(5),
    p50.toFixed(0).padStart(6), p95.toFixed(0).padStart(6), p99.toFixed(0).padStart(6), String(budget).padStart(7), pass ? ' PASS' : ` FAIL ${[...statuses].map(([s, n]) => `${s}x${n}`).join(' ')}`,
  );
}
console.log(`\n${scenarios.length - failed} passed, ${failed} FAILED`);
process.exit(failed ? 1 : 0);
