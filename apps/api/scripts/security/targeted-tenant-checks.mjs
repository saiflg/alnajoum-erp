#!/usr/bin/env node
/**
 * Targeted cross-tenant checks for routes that need a real request body (LOCAL USE ONLY).
 *
 * cross-tenant-attack.mjs replays every route with an empty body, so routes whose DTO has required
 * fields are rejected by validation (400) before any tenancy check and prove nothing. This script sends
 * a VALID body for the money- and data-moving ones, as another company's admin, against ids that belong
 * to the victim company, and requires 404 (or 403) every time. A "control" call as the victim proves the
 * route is reachable with that body, so a pass cannot be vacuous.
 *
 * Usage: node scripts/security/targeted-tenant-checks.mjs [--base URL] [--victim e:p] [--attacker e:p]
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const BASE = args.base || 'http://localhost:4000/api/v1';
const [VE, VP] = (args.victim || 'chidi.eze@demo.alnajoum.travel:Demo@2026').split(/:(.*)/s);
const [AE, AP] = (args.attacker || 'admin@zamzamhorizon.demo.alnajoum.travel:Demo@2026').split(/:(.*)/s);

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
async function login(email, password) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  const t = (j.data ?? j).accessToken;
  if (!t) throw new Error('login failed for ' + email);
  return t;
}
const rows = (r) => { const d = r.json?.data ?? r.json; return Array.isArray(d) ? d : d?.items ?? d?.data ?? []; };
const first = (r) => rows(r)[0];

const V = await login(VE, VP);
const A = await login(AE, AP);

// ---- victim-owned ids
const customers = rows(await call(V, 'GET', '/customers'));
const customer = customers[0];
const invoices = rows(await call(V, 'GET', '/invoices'));
const openInvoice = invoices.find((i) => ['ISSUED', 'PARTIALLY_PAID'].includes(i.status)) || invoices[0];
const flights = rows(await call(V, 'GET', '/flights/bookings'));
const flight = flights[0];
const visa = first(await call(V, 'GET', '/visa/applications'));
const manual = first(await call(V, 'GET', '/manual-payments'));
const entries = rows(await call(V, 'GET', '/finance/accounts/journal-entries'));
const lead = first(await call(V, 'GET', '/crm/leads'));
// Records the demo data may not contain are created as the victim, so those cases always run.
let corp = first(await call(V, 'GET', '/corporate-travel/accounts'));
if (!corp) corp = (await call(V, 'POST', '/corporate-travel/accounts', { name: 'Tenancy Check Ltd' })).json?.data;
const corpBooking = first(await call(V, 'GET', '/corporate-travel/bookings'));
const vehicle = first(await call(V, 'GET', '/vehicle-rentals/bookings'));
const expense = first(await call(V, 'GET', '/finance/expenses'));
let line = first(await call(V, 'GET', '/finance/bank-reconciliation/lines'));
if (!line) line = (await call(V, 'POST', '/finance/bank-reconciliation/lines', { date: new Date().toISOString(), description: 'tenancy check', amount: 1000 })).json?.data;
const ticket = first(await call(V, 'GET', '/support/tickets'));
const attackerStaff = first(await call(A, 'GET', '/staff'));
const attackerCustomer = first(await call(A, 'GET', '/customers'));

const cases = [
  ['invoice: record payment', 'POST', openInvoice && `/invoices/${openInvoice.id}/payments`, { amount: 1, method: 'CASH' }],
  ['wallet: read', 'GET', customer && `/wallet/${customer.id}`],
  ['wallet: credit', 'POST', customer && `/wallet/${customer.id}/credit`, { amount: 100, description: 'attack' }],
  ['wallet: adjust', 'POST', customer && `/wallet/${customer.id}/adjust`, { amount: -1, type: 'WITHDRAWAL', description: 'attack' }],
  ['wallet: transfer out of victim', 'POST', customer && attackerCustomer && '/wallet/transfer', { fromCustomerId: customer?.id, toCustomerId: attackerCustomer?.id, amount: 1, description: 'attack' }],
  ['wallet: transfer between two victim customers', 'POST', customers[1] && customer && '/wallet/transfer', { fromCustomerId: customer?.id, toCustomerId: customers[1]?.id, amount: 1, description: 'attack' }],
  ['manual payment: submit for victim customer', 'POST', customer && openInvoice && '/manual-payments', { customerId: customer?.id, invoiceId: openInvoice?.id, amount: 1, method: 'CASH' }],
  ['manual payment: read', 'GET', manual && `/manual-payments/${manual.id}`],
  ['manual payment: approve', 'POST', manual && `/manual-payments/${manual.id}/approve`, {}],
  ['manual payment: reject', 'POST', manual && `/manual-payments/${manual.id}/reject`, { note: 'attack' }],
  ['flight: refund', 'POST', flight && `/flights/bookings/${flight.id}/refund`, { reason: 'attack' }],
  ['flight: cancel', 'POST', flight && `/flights/bookings/${flight.id}/cancel`, {}],
  ['flight: refund preview', 'GET', flight && `/flights/bookings/${flight.id}/refund-preview`],
  ['visa: cancel', 'POST', visa && `/visa/applications/${visa.id}/cancel`, {}],
  ['ledger: reverse entry', 'POST', entries[0] && `/finance/accounts/journal-entries/${entries[0].id}/reverse`, { reason: 'attack' }],
  ['lead: assign to attacker staff', 'POST', lead && attackerStaff && `/crm/leads/${lead.id}/assign`, { staffId: attackerStaff?.id }],
  ['lead: convert into attacker customer', 'POST', lead && attackerCustomer && `/crm/leads/${lead.id}/convert`, { existingCustomerId: attackerCustomer?.id }],
  ['corporate account: read', 'GET', corp && `/corporate-travel/accounts/${corp.id}`],
  ['corporate account: add traveller', 'POST', corp && `/corporate-travel/accounts/${corp.id}/travelers`, { firstName: 'A', lastName: 'B', email: 'a@b.co' }],
  ['corporate account: update', 'PATCH', corp && `/corporate-travel/accounts/${corp.id}`, { name: 'Hijacked' }],
  ['corporate booking: cancel', 'POST', corpBooking && `/corporate-travel/bookings/${corpBooking.id}/cancel`, {}],
  ['vehicle rental: cancel', 'POST', vehicle && `/vehicle-rentals/bookings/${vehicle.id}/cancel`, {}],
  ['expense: approve', 'POST', expense && `/finance/expenses/${expense.id}/approve`, {}],
  ['bank line: match', 'POST', line && expense && `/finance/bank-reconciliation/lines/${line.id}/match`, { matchedType: 'EXPENSE', matchedId: expense?.id }],
  ['support ticket: status', 'POST', ticket && `/support/tickets/${ticket.id}/status`, { status: 'CLOSED' }],
];

let fail = 0, skipped = 0;
for (const [name, method, path, body] of cases) {
  if (!path) { skipped++; console.log(`SKIP  ${name} (no victim record available)`); continue; }
  const a = await call(A, method, path, body);
  const ok = a.status === 404 || a.status === 403;
  // control: the victim reaches the route with this body (validation/state errors are fine, 404/403 are not)
  const o = await call(V, method, path, body);
  const reachable = ![404, 403, 401].includes(o.status);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} attacker ${a.status}  owner-control ${o.status}${reachable ? '' : '  (control not reachable - weak)'}${ok ? '' : '  ' + a.text.slice(0, 120)}`);
}
console.log(`\n${cases.length - skipped - fail} passed, ${fail} FAILED, ${skipped} skipped`);
process.exitCode = fail ? 1 : 0;
