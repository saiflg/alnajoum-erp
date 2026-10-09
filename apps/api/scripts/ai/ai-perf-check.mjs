#!/usr/bin/env node
/**
 * Local load and concurrency checks of the AI agent layer (LOCAL USE ONLY; mock AI provider, development data).
 * Measures latency percentiles under concurrency and verifies that correctness and duplicate-prevention still
 * hold under load. These numbers describe THIS machine with the MOCK provider: they say nothing about a real
 * provider's latency.
 *
 *   node scripts/ai/ai-perf-check.mjs [--conversations 40] [--staff 25]
 */
import { execFileSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? Number(process.argv[i + 1]) : d; };
const CONVS = arg('conversations', 40);
const STAFF = arg('staff', 25);
const BASE = 'http://localhost:4000/api/v1';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', process.env.DB_NAME || 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();

// The mock payment provider settles a payment link by itself, so earlier runs leave the demo customer owing
// nothing. Make the starting state deterministic: if there is no unpaid invoice, book one through the assistant.
async function ensureUnpaidInvoice(token, customerId, postMessage) {
  const open = () => Number(sql(`select count(*) from invoices where "customerId"='${customerId}' and status in ('ISSUED','PARTIALLY_PAID')`));
  if (open() > 0) return;
  const a = await postMessage(token, 'Find me a flight from Lagos to Abuja on 15 December');
  await postMessage(token, 'confirm 1', a.conversationId);
  if (open() === 0) throw new Error('could not create an unpaid invoice for the test customer');
}
const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(78)} ${detail}`); };
async function post(path, token, body) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, ms: performance.now() - t0 };
}
const get = async (path, token) => { const t0 = performance.now(); const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } }); await r.json().catch(() => null); return { status: r.status, ms: performance.now() - t0 }; };
const login = async (email, password = 'Demo@2026') => (await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).data.accessToken;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };

const customer = await login('chinedu.okafor@demo.alnajoum.travel');
const admin = await login('chidi.eze@demo.alnajoum.travel');
const customerId = sql(`select c.id from customers c join identities i on i.id=c."identityId" where i.email='chinedu.okafor@demo.alnajoum.travel'`);
await ensureUnpaidInvoice(customer, customerId, async (token, content, conversationId) => (await post('/ai/assistant/message', token, { content, conversationId })).data);
const owed = Number(sql(`select coalesce(sum(i."totalAmount" - coalesce((select sum(p.amount) from payments p where p."invoiceId"=i.id),0)),0) from invoices i where i."customerId"='${customerId}' and i.status in ('ISSUED','PARTIALLY_PAID')`));

// 1. concurrent customer conversations
let t0 = performance.now();
const convs = await Promise.all(Array.from({ length: CONVS }, () => post('/ai/assistant/message', customer, { content: 'How much do I owe?' })));
const wall1 = performance.now() - t0;
const ok1 = convs.filter((c) => c.status === 201 && String(c.data.messages?.[1]?.content ?? '').replace(/[^\d]/g, '').includes(String(owed)));
const lat1 = convs.map((c) => c.ms);
check(`${CONVS} concurrent customer conversations all answered correctly from the ledger`, ok1.length === CONVS, `${ok1.length}/${CONVS}, wall ${Math.round(wall1)} ms, p50 ${pct(lat1, 50)} p95 ${pct(lat1, 95)} p99 ${pct(lat1, 99)} ms`);
check('each got its own conversation and execution (no cross-talk)', new Set(convs.map((c) => c.data.conversationId)).size === CONVS && new Set(convs.map((c) => c.data.executionId)).size === CONVS);

// 2. concurrent staff asks (multiple tool calls each)
t0 = performance.now();
const asks = await Promise.all(Array.from({ length: STAFF }, () => post('/ai/copilot/ask', admin, { objective: "Summarize today's operations" })));
const wall2 = performance.now() - t0;
check(`${STAFF} concurrent copilot summaries (3 tool calls each) all complete`, asks.every((a) => a.status === 201 && a.data.status === 'COMPLETED'), `wall ${Math.round(wall2)} ms, p50 ${pct(asks.map((a) => a.ms), 50)} p95 ${pct(asks.map((a) => a.ms), 95)} ms`);

// 3. duplicates under load: the same task requested many times at once creates ONE task
// Letters only: a long digit string can be (correctly) masked as a possible card number.
const marker = `Perf duplicate check ${Math.random().toString(36).replace(/[0-9.]/g, '').slice(0, 8)}`;
const dup = await Promise.all(Array.from({ length: 20 }, () => post('/ai/copilot/ask', admin, { objective: `Create a task to ${marker}` })));
check('20 simultaneous identical "create a task" requests create exactly ONE task', Number(sql(`select count(*) from tasks where title like '%${marker}%'`)) === 1, `${dup.filter((d) => d.status === 201).length} accepted`);

// 4. payment link under load: one attempt only
const inv = sql(`select i."invoiceNumber" from invoices i where i."customerId"='${customerId}' and i.status in ('ISSUED','PARTIALLY_PAID') order by i."createdAt" limit 1`);
sql(`delete from ai_action_records where "toolKey"='createPaymentLink'`);
const before = Number(sql(`select count(*) from payment_intents where "customerId"='${customerId}'`));
await Promise.all(Array.from({ length: 15 }, () => post('/ai/assistant/message', customer, { content: `Send me a payment link for ${inv}` })));
const added = Number(sql(`select count(*) from payment_intents where "customerId"='${customerId}'`)) - before;
check('15 simultaneous payment-link requests create exactly ONE payment attempt', added === 1, `${added} created`);

// 5. dashboards and scans on realistic volumes
const rows = Number(sql(`select count(*) from ai_executions`));
const dash = await Promise.all([get('/ai/overview?days=30', admin), get('/ai/control-tower', admin), get('/ai/executions', admin), get('/ai/recommendations', admin)]);
check(`dashboards over ${rows} recorded runs respond within 2 s`, dash.every((d) => d.status === 200 && d.ms < 2000), dash.map((d) => `${Math.round(d.ms)}ms`).join(' '));
const sc = await post('/ai/scan', admin, {});
check('a full company scan + briefing completes within 15 s and is repeatable', sc.status === 201 && sc.ms < 15000, `${Math.round(sc.ms)} ms`);
const sc2 = await post('/ai/scan', admin, {});
check('...a second scan creates nothing new (idempotent bulk follow-ups)', (sc2.data.scans ?? []).every((s) => s.created === 0), `${Math.round(sc2.ms)} ms`);
const bf = await Promise.all(Array.from({ length: 10 }, () => post('/ai/briefing/generate', admin, {})));
check('10 simultaneous briefing requests produce ONE briefing row for the day', new Set(bf.map((b) => b.data.id)).size === 1);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exitCode = failed ? 1 : 0;
