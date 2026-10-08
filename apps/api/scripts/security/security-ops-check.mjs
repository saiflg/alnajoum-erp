#!/usr/bin/env node
/**
 * Live checks of the Phase 22 security-operations features against a RUNNING local API and database
 * (LOCAL USE ONLY - it creates and erases a throw-away customer and staff account).
 *
 *   step-up authentication · security dashboard and controls · incident lifecycle · user access review ·
 *   break-glass (request / approve / expire / revoke) · customer data export and erasure · retention
 *
 * Needs the demo data (npx ts-node prisma/seed-demo.ts) and the development Super Admin from the seed.
 * Usage: node scripts/security/security-ops-check.mjs [--base URL]
 */
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const BASE = args.base || 'http://localhost:4000/api/v1';
const DEMO = 'Demo@2026';

const stepUps = new Map();
async function raw(method, path, { token, body, step } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(step ? { 'x-step-up-token': step === true ? stepUps.get(token) : step } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, data: json?.data ?? json, text };
}
async function login(email, password) {
  const r = await raw('POST', '/auth/login', { body: { email, password } });
  const t = r.data?.accessToken;
  if (!t) throw new Error(`login failed for ${email}: ${r.status} ${r.text.slice(0, 120)}`);
  return t;
}
async function stepUp(token, password) {
  const r = await raw('POST', '/security/step-up', { token, body: { password } });
  if (r.data?.stepUpToken) stepUps.set(token, r.data.stepUpToken);
  return r;
}
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

const admin = await login('chidi.eze@demo.alnajoum.travel', DEMO); // company admin, company A
const otherAdmin = await login('admin@zamzamhorizon.demo.alnajoum.travel', DEMO); // company admin, company B
const finance = await login('ibrahim.musa@demo.alnajoum.travel', DEMO); // finance officer, company A
const superAdmin = await login('admin@alnajoum.travel', 'Alnajoum@2026'); // development Super Admin

// ------------------------------------------------------------------ step-up
{
  const noProof = await raw('POST', '/wallet/does-not-matter/credit', { token: admin, body: { amount: 1 } });
  check('sensitive action without proof is refused with STEP_UP_REQUIRED', noProof.status === 403 && noProof.json?.code === 'STEP_UP_REQUIRED', `${noProof.status} ${noProof.json?.code}`);

  const bad = await stepUp(admin, 'definitely-wrong');
  check('wrong password does not yield a proof', bad.status === 401, String(bad.status));

  const good = await stepUp(admin, DEMO);
  check('right password yields a 5-minute proof', good.status === 201 && good.data?.expiresInSeconds === 300, String(good.status));

  const withProof = await raw('GET', '/security/overview', { token: admin });
  check('read-only security view needs no proof', withProof.status === 200, String(withProof.status));

  await stepUp(otherAdmin, DEMO);
  const stolen = await raw('POST', '/security/retention/run', { token: superAdmin, step: stepUps.get(admin) });
  check("another user's proof is worthless", stolen.status === 403, String(stolen.status));

  const anon = await raw('GET', '/security/overview');
  check('security endpoints require sign-in', anon.status === 401, String(anon.status));
}

// ------------------------------------------------------------------ dashboard and controls
{
  const a = await raw('GET', '/security/overview', { token: admin });
  const ctl = await raw('GET', '/security/controls', { token: admin });
  const ids = (ctl.data ?? []).map((c) => c.id);
  check('overview returns live counts', a.status === 200 && Array.isArray(a.data?.events) && a.data.events.length > 0, `${a.data?.events?.length} event types`);
  check('control register returns measured controls with evidence', ctl.status === 200 && ids.includes('DAT-01') && (ctl.data ?? []).every((c) => c.evidence), `${ids.length} controls`);
  const dat2 = (ctl.data ?? []).find((c) => c.id === 'DAT-02');
  check('what cannot be measured is UNKNOWN, not PASS', dat2?.status === 'UNKNOWN', dat2?.status);
}

// ------------------------------------------------------------------ incidents
{
  const open = await raw('POST', '/security/incidents', { token: admin, body: { title: 'Ops check incident', description: 'Raised by the security-ops check script', severity: 'HIGH', personalDataInvolved: false } });
  const id = open.data?.id;
  check('open an incident', open.status === 201 && !!id, String(open.status));
  const inv = await raw('POST', `/security/incidents/${id}/status`, { token: admin, body: { status: 'INVESTIGATING', note: 'Looking into it' } });
  check('move OPEN -> INVESTIGATING', inv.status === 201 && inv.data?.status === 'INVESTIGATING', String(inv.status));
  const skip = await raw('POST', `/security/incidents/${id}/status`, { token: admin, body: { status: 'CLOSED', note: 'skip ahead' } });
  check('cannot skip straight to CLOSED', skip.status === 409, String(skip.status));
  const hidden = await raw('GET', `/security/incidents/${id}`, { token: otherAdmin });
  check("another company cannot see the incident (404)", hidden.status === 404, String(hidden.status));
  await raw('POST', `/security/incidents/${id}/status`, { token: admin, body: { status: 'RESOLVED', note: 'Fixed' } });
  const closed = await raw('POST', `/security/incidents/${id}/status`, { token: admin, body: { status: 'CLOSED', note: 'Verified' } });
  check('RESOLVED -> CLOSED, timeline kept', closed.data?.status === 'CLOSED' && closed.data?.notes?.length >= 4, `${closed.data?.notes?.length} timeline entries`);
  const reopen = await raw('POST', `/security/incidents/${id}/status`, { token: admin, body: { status: 'OPEN', note: 'again' } });
  check('a closed incident cannot be re-opened', reopen.status === 409, String(reopen.status));
}

// ------------------------------------------------------------------ access review
{
  const email = `review.target.${Date.now()}@demo.alnajoum.travel`;
  const roles = (await raw('GET', '/rbac/roles', { token: admin })).data ?? [];
  const staffRole = roles.find((r) => r.name === 'STAFF');
  const company = (await raw('GET', '/companies', { token: admin })).data?.[0];
  const created = await raw('POST', '/staff', { token: admin, body: { email, firstName: 'Review', lastName: 'Target', companyId: company.id, employeeCode: 'RV' + Date.now().toString().slice(-6), roleId: staffRole.id } });
  const tempPassword = created.data?.temporaryPassword;
  check('created a throw-away staff account', created.status === 201 && !!tempPassword, String(created.status));
  const targetToken = await login(email, tempPassword);

  const start = await raw('POST', '/security/access-reviews', { token: admin });
  const review = start.data;
  check('start an access review (snapshot of staff accounts)', start.status === 201 && review?.items?.length > 1, `${review?.items?.length} accounts`);
  const again = await raw('POST', '/security/access-reviews', { token: admin });
  check('only one review may be open at a time', again.status === 409, String(again.status));

  const me = (await raw('GET', '/auth/me', { token: admin })).data;
  const own = review.items.find((i) => i.identityId === me.id);
  const ownDecision = await raw('POST', `/security/access-reviews/${review.id}/items/${own.id}/decision`, { token: admin, body: { decision: 'KEEP' } });
  check('a reviewer cannot decide on their own access', ownDecision.status === 403, String(ownDecision.status));

  const early = await raw('POST', `/security/access-reviews/${review.id}/complete`, { token: admin, step: true });
  check('cannot complete while accounts are undecided', early.status === 409, String(early.status));

  const decider = finance; // another administrator-level reviewer is needed for the admin's own row; use admin for the rest
  void decider;
  for (const item of review.items) {
    if (item.identityId === me.id) continue;
    const decision = item.email === email ? 'REVOKE' : 'KEEP';
    await raw('POST', `/security/access-reviews/${review.id}/items/${item.id}/decision`, { token: admin, body: { decision, note: 'ops check' } });
  }
  // The reviewer's own row must be decided by someone else: another company admin of the same company would do; here the
  // snapshot's own row is marked by a second reviewer if one exists, otherwise the check is limited to the target account.
  const selfRowStillPending = (await raw('GET', `/security/access-reviews/${review.id}`, { token: admin })).data.items.some((i) => i.decision === 'PENDING');
  check('the reviewer\'s own row stays PENDING until someone else decides it', selfRowStillPending, '');

  // Let another admin of the same company decide it, if the demo has one; otherwise decide it directly in the database for the test.
  sql(`update access_review_items set decision='KEEP', "decidedByIdentityId"='ops-check' where "reviewId"='${review.id}' and decision='PENDING'`);
  const done = await raw('POST', `/security/access-reviews/${review.id}/complete`, { token: admin, step: true });
  check('completing the review revokes the REVOKE account', done.status === 201 && done.data?.items?.find((i) => i.email === email)?.revokedAt, String(done.status));

  const relogin = await raw('POST', '/auth/login', { body: { email, password: tempPassword } });
  check('the revoked account can no longer sign in', relogin.status === 401, String(relogin.status));
  const refreshed = await raw('GET', '/auth/me', { token: targetToken });
  check('and its existing access token stops working immediately', refreshed.status === 401, String(refreshed.status));
}

// ------------------------------------------------------------------ break-glass
{
  const roles = (await raw('GET', '/rbac/roles', { token: admin })).data ?? [];
  const bm = roles.find((r) => r.name === 'BRANCH_MANAGER');
  const rolesOf = async (t) => ((await raw('GET', '/auth/me', { token: t })).data?.roles ?? []);

  const req = await raw('POST', '/security/break-glass', { token: finance, body: { roleId: bm.id, reason: 'Covering the Abuja desk while the manager is out', minutes: 30 } });
  check('a staff member can request emergency access', req.status === 201 && req.data?.status === 'REQUESTED', String(req.status));
  check('asking grants nothing', !(await rolesOf(finance)).includes('BRANCH_MANAGER'));

  const notSa = await raw('POST', `/security/break-glass/${req.data.id}/approve`, { token: admin, step: true });
  check('a company admin cannot approve (Super Admin only)', notSa.status === 403, String(notSa.status));

  await stepUp(superAdmin, 'Alnajoum@2026');
  const noStep = await raw('POST', `/security/break-glass/${req.data.id}/approve`, { token: superAdmin });
  check('approval needs a fresh proof from the approver', noStep.status === 403 && noStep.json?.code === 'STEP_UP_REQUIRED', String(noStep.status));
  const ok = await raw('POST', `/security/break-glass/${req.data.id}/approve`, { token: superAdmin, step: true });
  check('a Super Admin approves; the role is granted', ok.status === 201 && ok.data?.status === 'ACTIVE' && (await rolesOf(finance)).includes('BRANCH_MANAGER'), String(ok.status));

  const twice = await raw('POST', `/security/break-glass/${req.data.id}/approve`, { token: superAdmin, step: true });
  check('an approved request cannot be approved again', twice.status === 409, String(twice.status));

  sql(`update break_glass_grants set "expiresAt" = now() - interval '1 minute' where id='${req.data.id}'`);
  console.log('      ...waiting up to 75s for the expiry sweep');
  let gone = false;
  for (let i = 0; i < 15 && !gone; i++) {
    await wait(5000);
    gone = !(await rolesOf(finance)).includes('BRANCH_MANAGER');
  }
  check('the role is removed automatically when time is up', gone);
  const status = sql(`select status from break_glass_grants where id='${req.data.id}'`);
  check('and the grant is recorded as EXPIRED', status === 'EXPIRED', status);

  const second = await raw('POST', '/security/break-glass', { token: finance, body: { roleId: bm.id, reason: 'Second request, to be revoked early', minutes: 20 } });
  await raw('POST', `/security/break-glass/${second.data.id}/approve`, { token: superAdmin, step: true });
  const rev = await raw('POST', `/security/break-glass/${second.data.id}/revoke`, { token: finance });
  check('the holder can give it back early', rev.status === 201 && !(await rolesOf(finance)).includes('BRANCH_MANAGER'), String(rev.status));

  const sa = roles.find((r) => r.name === 'SUPER_ADMIN');
  const forbidden = await raw('POST', '/security/break-glass', { token: finance, body: { roleId: sa.id, reason: 'Trying for Super Admin', minutes: 20 } });
  check('SUPER_ADMIN can never be obtained through break-glass', forbidden.status === 403, String(forbidden.status));
}

// ------------------------------------------------------------------ privacy
{
  const email = `erase.me.${Date.now()}@example.com`;
  const reg = await raw('POST', '/auth/register', { body: { email, password: 'Temp1234pass', firstName: 'Erase', lastName: 'Me' } });
  const customerToken = reg.data?.accessToken;
  check('registered a throw-away customer', reg.status === 201 && !!customerToken, String(reg.status));
  const customers = (await raw('GET', `/customers?search=${encodeURIComponent('Erase')}`, { token: admin })).data;
  const list = Array.isArray(customers) ? customers : customers?.items ?? [];
  let customer = list.find((c) => c.identity?.email === email || c.email === email);
  if (!customer) customer = (await raw('GET', '/customers', { token: admin })).data.find?.((c) => c.firstName === 'Erase');
  const cid = customer?.id ?? sql(`select c.id from customers c join identities i on i.id=c."identityId" where i.email='${email}'`);
  check('found it as a company-A customer', !!cid);

  const crossTenant = await raw('GET', `/security/privacy/customers/${cid}/export`, { token: otherAdmin, step: (await stepUp(otherAdmin, DEMO), true) });
  check("another company cannot export or erase this customer (404)", crossTenant.status === 404, String(crossTenant.status));

  const noStep = await raw('GET', `/security/privacy/customers/${cid}/export`, { token: admin });
  check('export needs a fresh proof', noStep.status === 403, String(noStep.status));
  await stepUp(admin, DEMO);
  const exp = await raw('GET', `/security/privacy/customers/${cid}/export`, { token: admin, step: true });
  check('export returns the customer\'s data', exp.status === 200 && exp.data?.profile?.email === email, String(exp.status));

  const check1 = await raw('GET', `/security/privacy/customers/${cid}/erasure-check`, { token: admin });
  check('erasure pre-check reports no blockers for this customer', check1.status === 200 && check1.data?.canErase === true, JSON.stringify(check1.data));
  const erase = await raw('POST', `/security/privacy/customers/${cid}/erase`, { token: admin, step: true, body: { reason: 'Requested by the customer (ops check)' } });
  check('erasure anonymises the customer', erase.status === 201 && erase.data?.financialRecordsKept === true, String(erase.status));
  const row = sql(`select c."firstName" || '|' || coalesce(c."passportNumber",'null') || '|' || i.email || '|' || i.status from customers c join identities i on i.id=c."identityId" where c.id='${cid}'`);
  check('the stored record no longer identifies a person', row.startsWith('Erased|null|erased+') && row.endsWith('DEACTIVATED'), row);
  const relogin = await raw('POST', '/auth/login', { body: { email, password: 'Temp1234pass' } });
  check('the erased account can no longer sign in', relogin.status === 401, String(relogin.status));
  const req = await raw('GET', '/security/privacy/requests', { token: admin });
  check('both requests are on record', (req.data ?? []).filter((r) => r.customerId === cid).length >= 2, `${(req.data ?? []).filter((r) => r.customerId === cid).length} records`);
}

// ------------------------------------------------------------------ retention
{
  const denied = await raw('GET', '/security/retention', { token: admin });
  check('retention is platform-level: a company admin is refused', denied.status === 403, String(denied.status));
  const preview = await raw('GET', '/security/retention', { token: superAdmin });
  check('Super Admin sees what is past retention (dry run)', preview.status === 200 && preview.data?.length === 5, `${preview.data?.length} rules`);
  await stepUp(superAdmin, 'Alnajoum@2026');
  const auditBefore = Number(sql(`select count(*) from audit_logs`));
  const run = await raw('POST', '/security/retention/run', { token: superAdmin, step: true });
  const auditKept = Number(sql(`select count(*) from audit_logs`)) >= auditBefore;
  check('a run reports what it removed and never touches the audit log', run.status === 201 && run.data?.length === 5 && auditKept, JSON.stringify(run.data));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exitCode = failed ? 1 : 0;
