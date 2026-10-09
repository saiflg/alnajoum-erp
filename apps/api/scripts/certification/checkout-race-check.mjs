#!/usr/bin/env node
/**
 * Live check of the single-checkout-per-invoice guard (Phase 24). LOCAL USE ONLY: it books and pays an invoice
 * for a demo customer in the development database, using the MOCK payment provider.
 *
 *   node scripts/certification/checkout-race-check.mjs
 *
 * Found by the financial reconciliation: two concurrent checkouts on one unpaid invoice each created a
 * full-balance intent and both settled, so the invoice ended up paid twice. This proves the guard now holds
 * against real simultaneous requests into real Postgres.
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const DEMO = 'Demo@2026';
const N = 8;
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', process.env.DB_NAME || 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();
const num = (q) => Number(sql(q) || 0);

const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(86)} ${String(detail).slice(0, 100)}`); };

async function raw(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, data: json?.data ?? json };
}
const login = async (email) => {
  const r = await raw('POST', '/auth/login', { body: { email, password: DEMO } });
  if (!r.data?.accessToken) throw new Error(`login failed ${email}: ${r.status}`);
  return r.data.accessToken;
};
const race = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

const EMAIL = 'chinedu.okafor@demo.alnajoum.travel';
const customer = await login(EMAIL);
const customerId = sql(`select c.id from customers c join identities i on i.id=c."identityId" where i.email='${EMAIL}'`);

// Starting state: one unpaid invoice (book one through the assistant if the customer owes nothing).
const openInvoice = () => sql(`select id from invoices where "customerId"='${customerId}' and status in ('ISSUED','PARTIALLY_PAID') order by "createdAt" desc limit 1`);
if (!openInvoice()) {
  const a = await raw('POST', '/ai/assistant/message', { token: customer, body: { content: 'Find me a flight from Lagos to Abuja on 15 December' } });
  await raw('POST', '/ai/assistant/message', { token: customer, body: { content: 'confirm 1', conversationId: a.data?.conversationId } });
}
const invoiceId = openInvoice();
if (!invoiceId) { console.log('FAIL  could not obtain an unpaid invoice for the test customer'); process.exit(1); }
// Test set-up only: close intents left over from earlier runs so they cannot block this one.
sql(`update payment_intents set status='FAILED' where "invoiceId"='${invoiceId}' and status='PENDING'`);
const paymentsBefore = num(`select count(*) from payments where "invoiceId"='${invoiceId}'`);
const outstanding = num(`select i."totalAmount" - coalesce((select sum(amount) from payments p where p."invoiceId"=i.id),0) from invoices i where i.id='${invoiceId}'`);

// 1. N simultaneous checkouts on one unpaid invoice -> one intent
const starts = await race(N, () => raw('POST', `/invoices/me/${invoiceId}/checkout`, { token: customer }));
const accepted = starts.filter((r) => r.status >= 200 && r.status < 300);
const refused = starts.filter((r) => r.status === 409);
check(`${N} simultaneous checkouts on one invoice: exactly one is accepted`, accepted.length === 1, `${accepted.length} accepted, ${refused.length} refused (409), others: ${starts.length - accepted.length - refused.length}`);
const pending = num(`select count(*) from payment_intents where "invoiceId"='${invoiceId}' and status='PENDING'`);
check('only one PENDING payment intent exists for the invoice', pending === 1, `${pending}`);
const intentAmount = num(`select amount from payment_intents where "invoiceId"='${invoiceId}' and status='PENDING' limit 1`);
check('the intent is for the outstanding balance, read under the lock', intentAmount === outstanding, `${intentAmount} vs ${outstanding}`);
check('the refusal says a payment is already in progress', refused.every((r) => /already in progress/i.test(r.json?.message ?? r.json?.error?.message ?? JSON.stringify(r.json))), JSON.stringify(refused[0]?.json).slice(0, 90));

// 2. a second attempt a moment later is still refused while the first is pending
const again = await raw('POST', `/invoices/me/${invoiceId}/checkout`, { token: customer });
check('another checkout while the first is pending is refused', again.status === 409, `${again.status}`);

// 3. N simultaneous confirmations of that one checkout -> one payment
const reference = accepted[0]?.data?.reference;
const confirms = await race(N, () => raw('POST', `/invoices/me/${invoiceId}/checkout/verify`, { token: customer, body: { reference } }));
const paymentsAfter = num(`select count(*) from payments where "invoiceId"='${invoiceId}'`);
check(`${N} simultaneous confirmations of one checkout record exactly one payment`, paymentsAfter - paymentsBefore === 1, `payments ${paymentsBefore} -> ${paymentsAfter}; statuses ${[...new Set(confirms.map((c) => c.status))].join(',')}`);
const reconciled = num(`select count(*) from invoices i where i.id='${invoiceId}' and (select coalesce(sum(amount),0) from payments p where p."invoiceId"=i.id) <= i."totalAmount"`);
check('the invoice is not over-paid', reconciled === 1);
const status = sql(`select status from invoices where id='${invoiceId}'`);
check('the invoice is PAID once the one payment covers it', status === 'PAID', status);

// 4. a settled invoice accepts no further checkout
const late = await raw('POST', `/invoices/me/${invoiceId}/checkout`, { token: customer });
check('a fully paid invoice refuses a new checkout', late.status === 409, `${late.status}`);

// 5. A checkout that completes AFTER the invoice was settled another way (an abandoned checkout finishing late)
//    must not over-pay the invoice: the surplus becomes ledgered credit on the customer's wallet.
{
  const bookUnpaid = async () => {
    const a = await raw('POST', '/ai/assistant/message', { token: customer, body: { content: 'Find me a flight from Lagos to Abuja on 15 December' } });
    await raw('POST', '/ai/assistant/message', { token: customer, body: { content: 'confirm 1', conversationId: a.data?.conversationId } });
    return openInvoice();
  };
  const lateInvoice = await bookUnpaid();
  const total = num(`select "totalAmount" from invoices where id='${lateInvoice}'`);
  const start = await raw('POST', `/invoices/me/${lateInvoice}/checkout`, { token: customer });
  const lateRef = start.data?.reference;
  check('a checkout is opened on a second unpaid invoice', start.status >= 200 && start.status < 300 && !!lateRef, `${start.status}`);

  // staff settle the invoice in cash while that checkout is still open
  const adminToken = await login('chidi.eze@demo.alnajoum.travel');
  const cash = await raw('POST', `/invoices/${lateInvoice}/payments`, { token: adminToken, body: { amount: total, method: 'CASH', note: 'settled at the counter' } });
  check('the invoice is settled in cash while the checkout is open', cash.status >= 200 && cash.status < 300, `${cash.status}`);

  const walletBefore = num(`select coalesce(sum(t.amount),0) from wallet_transactions t join wallets w on w.id=t."walletId" where w."customerId"='${customerId}' and t.status='COMPLETED'`);
  const settle = await raw('POST', `/invoices/me/${lateInvoice}/checkout/verify`, { token: customer, body: { reference: lateRef } });
  check('the late checkout is accepted (the customer really paid)', settle.status >= 200 && settle.status < 300, `${settle.status}`);
  const paid = num(`select coalesce(sum(amount),0) from payments where "invoiceId"='${lateInvoice}'`);
  check('the invoice is NOT over-paid by the late checkout', paid === total, `paid ${paid} of ${total}`);
  check('no payment row was created for the late checkout', num(`select count(*) from payments where "paymentReference"='${lateRef}'`) === 0);
  const walletAfter = num(`select coalesce(sum(t.amount),0) from wallet_transactions t join wallets w on w.id=t."walletId" where w."customerId"='${customerId}' and t.status='COMPLETED'`);
  check('the whole amount was credited to the customer wallet', walletAfter - walletBefore === total, `+${walletAfter - walletBefore} (expected +${total})`);
  check('the credit has its own ledger entry for the same amount', num(`select count(*) from journal_entries where reference='SURPLUS-${lateRef}' and amount=${total} and status='POSTED'`) === 1);
  check('the intent is marked SUCCEEDED exactly once', sql(`select status from payment_intents where reference='${lateRef}'`) === 'SUCCEEDED');
  const again = await raw('POST', `/invoices/me/${lateInvoice}/checkout/verify`, { token: customer, body: { reference: lateRef } });
  check('confirming the same checkout again changes nothing (no second credit)', num(`select count(*) from wallet_transactions where reference='SURPLUS-${lateRef}'`) === 1, `${again.status}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exit(failed ? 1 : 0);
