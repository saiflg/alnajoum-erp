#!/usr/bin/env node
/**
 * Concurrency checks against a RUNNING local API and the real database (LOCAL USE ONLY - it writes data).
 *
 * Unit tests with mocks cannot prove that two requests arriving at the same instant are serialised: that
 * needs real simultaneous HTTP calls into real Postgres. Each case fires N identical requests in parallel
 * and then reads the resulting state, asserting the money cannot be double-spent / double-paid.
 *
 *   wallet debit race      N parallel withdrawals against a balance that covers only some of them
 *   idempotent credit      N parallel credits with the SAME idempotencyKey -> credited once
 *   invoice overpayment    N parallel full-balance payments -> exactly one succeeds
 *   journal reversal       N parallel reversals of one entry -> exactly one succeeds
 *   flight refund          N parallel refund requests for one booking -> exactly one succeeds
 *   expense approval       N parallel approvals of one expense -> exactly one succeeds
 *   manual payment review  N parallel approvals -> exactly one payment created
 *
 * Usage: node scripts/security/concurrency-check.mjs [--base URL] [--n 8]
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const BASE = args.base || 'http://localhost:4000/api/v1';
const N = Number(args.n || 8);
const PASSWORD = 'Demo@2026';


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
    headers: { authorization: `Bearer ${token}`, ...(stepUpTokens.has(token) ? { 'x-step-up-token': stepUpTokens.get(token) } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, data: json?.data ?? json, text };
}
async function login(email) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j = await r.json();
  const t = (j.data ?? j).accessToken;
  if (!t) throw new Error('login failed: ' + email);
  return t;
}
const race = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const count = (rs, pred) => rs.filter(pred).length;
const ok = (r) => r.status >= 200 && r.status < 300;
const rows = (r) => (Array.isArray(r.data) ? r.data : r.data?.items ?? []);

const admin = await login('chidi.eze@demo.alnajoum.travel');
const finance = await login('ibrahim.musa@demo.alnajoum.travel');
await obtainStepUp(BASE, admin, PASSWORD);
await obtainStepUp(BASE, finance, PASSWORD);

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
}

// ------------------------------------------------------------------ wallet
{
  const customer = rows(await call(admin, 'GET', '/customers'))[0];
  const start = (await call(admin, 'GET', `/wallet/${customer.id}`)).data.balance;

  const key = 'conc-' + Date.now();
  const credits = await race(N, () => call(admin, 'POST', `/wallet/${customer.id}/credit`, { amount: 10_000, description: 'concurrency check', idempotencyKey: key }));
  const afterCredit = (await call(admin, 'GET', `/wallet/${customer.id}`)).data.balance;
  report('idempotent credit (same key)', afterCredit - start === 10_000 && credits.every(ok), `${N} requests, balance +${afterCredit - start} (expected +10000)`);

  const balance = afterCredit;
  const debit = 3_000;
  const allowed = Math.floor(balance / debit);
  const debits = await race(N + 4, () => call(admin, 'POST', `/wallet/${customer.id}/adjust`, { amount: -debit, type: 'WITHDRAWAL', description: 'concurrency check' }));
  const afterDebit = (await call(admin, 'GET', `/wallet/${customer.id}`)).data.balance;
  const succeeded = count(debits, ok);
  report('wallet debit race (no overdraft)', afterDebit >= 0 && succeeded <= allowed && afterDebit === balance - succeeded * debit,
    `${N + 4} withdrawals of ${debit} against ${balance}: ${succeeded} succeeded (max ${allowed}), final balance ${afterDebit}`);
}

// ------------------------------------------------------------------ invoice overpayment
{
  const invoices = rows(await call(admin, 'GET', '/invoices'));
  let target;
  for (const inv of invoices.filter((i) => ['ISSUED', 'PARTIALLY_PAID'].includes(i.status))) {
    const d = (await call(admin, 'GET', `/invoices/${inv.id}`)).data;
    const paid = (d.payments || []).reduce((s, p) => s + p.amount, 0);
    if (d.totalAmount - paid > 0) { target = { id: inv.id, outstanding: d.totalAmount - paid, total: d.totalAmount }; break; }
  }
  if (!target) {
    report('invoice overpayment race', false, 'no open invoice in the demo data to test against');
  } else {
    const pays = await race(N, () => call(admin, 'POST', `/invoices/${target.id}/payments`, { amount: target.outstanding, method: 'CASH', note: 'concurrency check' }));
    const d = (await call(admin, 'GET', `/invoices/${target.id}`)).data;
    const paid = (d.payments || []).reduce((s, p) => s + p.amount, 0);
    report('invoice overpayment race', count(pays, ok) === 1 && paid <= d.totalAmount,
      `${N} full-balance payments: ${count(pays, ok)} succeeded, paid ${paid} of ${d.totalAmount}`);
  }
}

// ------------------------------------------------------------------ ledger reversal
{
  const entries = rows(await call(admin, 'GET', '/finance/accounts/journal-entries')).filter((e) => e.status === 'POSTED' && !e.reversalOfId);
  const entry = entries[entries.length - 1];
  if (!entry) report('journal reversal race', false, 'no POSTED entry to reverse');
  else {
    const revs = await race(N, () => call(admin, 'POST', `/finance/accounts/journal-entries/${entry.id}/reverse`, { reason: 'concurrency check' }));
    report('journal reversal race', count(revs, ok) === 1, `${N} reversals of one entry: ${count(revs, ok)} succeeded`);
  }
}

// ------------------------------------------------------------------ flight refund
{
  const bookings = rows(await call(admin, 'GET', '/flights/bookings')).filter((b) => ['TICKETED', 'CONFIRMED', 'PAID'].includes(b.status));
  const booking = bookings[0];
  if (!booking) report('flight refund race', false, 'no refundable booking in the demo data');
  else {
    const rs = await race(N, () => call(admin, 'POST', `/flights/bookings/${booking.id}/refund`, { reason: 'concurrency check' }));
    report('flight refund race', count(rs, ok) === 1, `${N} refund requests for one booking: ${count(rs, ok)} succeeded`);
  }
}

// ------------------------------------------------------------------ expense approval
{
  const created = await call(finance, 'POST', '/finance/expenses', { category: 'OFFICE', amount: 1234, date: new Date().toISOString(), description: 'concurrency check', currency: 'NGN' });
  const expense = created.data;
  if (!expense?.id) report('expense approval race', false, `could not create an expense: ${created.status} ${created.text.slice(0, 100)}`);
  else {
    const rs = await race(N, () => call(admin, 'POST', `/finance/expenses/${expense.id}/approve`, {}));
    const self = await call(finance, 'POST', `/finance/expenses/${expense.id}/approve`, {});
    report('expense approval race', count(rs, ok) === 1, `${N} approvals: ${count(rs, ok)} succeeded`);
    const own = await call(finance, 'POST', '/finance/expenses', { category: 'OFFICE', amount: 55, date: new Date().toISOString(), description: 'self-approval check', currency: 'NGN' });
    const selfApprove = await call(finance, 'POST', `/finance/expenses/${own.data?.id}/approve`, {});
    report('expense: no self-approval', selfApprove.status === 403, `submitter approving own expense -> ${selfApprove.status}`);
    void self;
  }
}

// ------------------------------------------------------------------ manual payment review
{
  const invoices = rows(await call(admin, 'GET', '/invoices'));
  let target;
  for (const inv of invoices.filter((i) => ['ISSUED', 'PARTIALLY_PAID'].includes(i.status))) {
    const d = (await call(admin, 'GET', `/invoices/${inv.id}`)).data;
    const paid = (d.payments || []).reduce((s, p) => s + p.amount, 0);
    if (d.totalAmount - paid > 10 && d.customerId) { target = { id: inv.id, customerId: d.customerId }; break; }
  }
  if (!target) report('manual payment approval race', false, 'no open invoice left');
  else {
    // The company admin records the claim; the finance officer reviews it (different people - the recorder may not review).
    const sub = await call(admin, 'POST', '/manual-payments', { customerId: target.customerId, invoiceId: target.id, amount: 5, method: 'BANK_TRANSFER' });
    if (!sub.data?.id) report('manual payment approval race', false, `submit failed: ${sub.status} ${sub.text.slice(0, 100)}`);
    else {
      const rs = await race(N, () => call(finance, 'POST', `/manual-payments/${sub.data.id}/approve`, {}));
      const d = (await call(admin, 'GET', `/invoices/${target.id}`)).data;
      const created = (d.payments || []).filter((p) => p.amount === 5 && /MPAY/.test(p.paymentReference || '')).length;
      report('manual payment approval race', count(rs, ok) === 1, `${N} approvals: ${count(rs, ok)} succeeded, ${created} payment(s) of 5 on the invoice`);
    }
  }
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exitCode = failed ? 1 : 0;
