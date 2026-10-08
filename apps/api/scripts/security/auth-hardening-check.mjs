#!/usr/bin/env node
/**
 * Live checks of the Phase 22 authentication and data-protection hardening against a RUNNING local API + database
 * (LOCAL USE ONLY - it creates throw-away accounts):
 *   2FA secret encrypted at rest and migrated · TOTP replay · 2FA lockout · single-use challenge · email
 *   normalisation · refresh without tokens in the body · refresh-token reuse detection · staff bank account
 *   encrypted at rest · public-endpoint throttles · request bodies that used to bypass validation.
 *
 * Run from apps/api so `otplib` resolves.  Usage: node scripts/security/auth-hardening-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { authenticator } from 'otplib';

const BASE = 'http://localhost:4000/api/v1';
const DEMO = 'Demo@2026';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function raw(method, path, { token, body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, data: json?.data ?? json, headers: res.headers, text };
}
const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(70)} ${detail}`); };
const setCookies = (r) => r.headers.getSetCookie?.() ?? [];
const cookieHeader = (r) => setCookies(r).map((c) => c.split(';')[0]).join('; ');

const stamp = Date.now();
const email = `hardening.${stamp}@example.com`;
const password = 'Hardening1234';

// ------------------------------------------------------------------ registration, normalisation
const reg = await raw('POST', '/auth/register', { body: { email: `  Hardening.${stamp}@EXAMPLE.com `, password, firstName: 'Hard', lastName: 'Ening' } });
check('register with a messy email address', reg.status === 201, String(reg.status));
check('the stored email is trimmed and lower-case', sql(`select count(*) from identities where email='${email}'`) === '1');
const upper = await raw('POST', '/auth/login', { body: { email: email.toUpperCase(), password } });
check('sign-in works regardless of letter case', upper.status === 201 && !!upper.data?.accessToken, String(upper.status));
let token = upper.data.accessToken;

// ------------------------------------------------------------------ refresh: cookies vs body
{
  const login = await raw('POST', '/auth/login', { body: { email, password } });
  const cookie = cookieHeader(login);
  const viaCookie = await raw('POST', '/auth/refresh', { cookie, body: {} });
  check('refresh through the cookie returns no tokens in the body', viaCookie.status === 201 && !viaCookie.data?.accessToken && !viaCookie.data?.refreshToken && !!viaCookie.data?.identity, JSON.stringify(Object.keys(viaCookie.data ?? {})));
  check('...but still sets the new cookies', setCookies(viaCookie).some((c) => c.startsWith('access_token')) , '');
  const viaBody = await raw('POST', '/auth/refresh', { body: { refreshToken: login.data.refreshToken } });
  // the cookie refresh above already rotated this login's token, so this one is a replay inside the grace window
  check('a token that was just rotated is refused (inside the grace window)', viaBody.status === 401, String(viaBody.status));
  const fresh = await raw('POST', '/auth/login', { body: { email, password } });
  const bodyRefresh = await raw('POST', '/auth/refresh', { body: { refreshToken: fresh.data.refreshToken } });
  check('API clients that send the token themselves still receive the new pair', bodyRefresh.status === 201 && !!bodyRefresh.data?.accessToken && !!bodyRefresh.data?.refreshToken, String(bodyRefresh.status));

  // reuse detection: replay the rotated token well after the grace window -> every session of this login dies
  console.log('      ...waiting 32s for the reuse grace window to pass');
  await wait(32000);
  const replay = await raw('POST', '/auth/refresh', { body: { refreshToken: fresh.data.refreshToken } });
  check('replaying a rotated refresh token later is refused', replay.status === 401, String(replay.status));
  const stillGood = await raw('POST', '/auth/refresh', { body: { refreshToken: bodyRefresh.data.refreshToken } });
  check('...and it revokes the whole login, including the legitimate newer token', stillGood.status === 401, String(stillGood.status));
  check('...and the theft is on the audit trail', Number(sql(`select count(*) from audit_logs where action='security.refresh_token_reuse'`)) >= 1);
}

// ------------------------------------------------------------------ 2FA
{
  const login = await raw('POST', '/auth/login', { body: { email, password } });
  token = login.data.accessToken;
  const setup = await raw('POST', '/auth/2fa/setup', { token });
  const secret = setup.data?.secret;
  const stored = sql(`select "twoFactorSecret" from identities where email='${email}'`);
  check('the authenticator secret is stored encrypted, not in plain text', stored.startsWith('enc:v1:') && !stored.includes(secret), stored.slice(0, 18) + '...');

  const enable = await raw('POST', '/auth/2fa/verify-enable', { token, body: { code: authenticator.generate(secret) } });
  const recovery = enable.data?.recoveryCodes ?? [];
  check('enable 2FA; recovery codes are 80-bit', enable.status === 201 && /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/.test(recovery[0] ?? ''), recovery[0]);

  // the enrolment code cannot be replayed to sign in
  const ch1 = (await raw('POST', '/auth/login', { body: { email, password } })).data.challengeToken;
  const replayEnrol = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: ch1, code: authenticator.generate(secret) } });
  check('the code that proved enrolment cannot be replayed to sign in', replayEnrol.status === 401, String(replayEnrol.status));

  // use a recovery code to sign in, then try to reuse the same challenge
  const ok = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: ch1, code: recovery[0] } });
  check('sign in with a recovery code', ok.status === 201 && !!ok.data?.accessToken, String(ok.status));
  const again = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: ch1, code: recovery[1] } });
  check('the same challenge cannot be used for a second sign-in', again.status === 401, String(again.status));
  const reuseCode = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: (await raw('POST', '/auth/login', { body: { email, password } })).data.challengeToken, code: recovery[0] } });
  check('a recovery code works exactly once', reuseCode.status === 401, String(reuseCode.status));

  // wrong codes count toward lockout
  const ch2 = (await raw('POST', '/auth/login', { body: { email, password } })).data.challengeToken;
  let last;
  for (let i = 0; i < 5; i++) last = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: ch2, code: '000000' } });
  const locked = await raw('POST', '/auth/login', { body: { email, password } });
  check('five wrong second-factor codes lock the account', locked.status === 401 && /temporarily unavailable/.test(locked.json?.message ?? ''), `${locked.status} ${locked.json?.message}`);
  const lockedVerify = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: ch2, code: recovery[2] } });
  check('a locked account cannot complete a second-factor sign-in either', lockedVerify.status === 401, String(lockedVerify.status));
  sql(`update identities set "lockedUntil"=null,"failedLoginCount"=0 where email='${email}'`);
}

// ------------------------------------------------------------------ legacy plaintext secret migration
{
  const legacyEmail = `legacy.${stamp}@example.com`;
  await raw('POST', '/auth/register', { body: { email: legacyEmail, password, firstName: 'Leg', lastName: 'Acy' } });
  sql(`update identities set "twoFactorSecret"='JBSWY3DPEHPK3PXP', "twoFactorEnabled"=true where email='${legacyEmail}'`);
  const before = sql(`select "twoFactorSecret" from identities where email='${legacyEmail}'`);
  const ch = (await raw('POST', '/auth/login', { body: { email: legacyEmail, password } })).data?.challengeToken;
  const ok = await raw('POST', '/auth/2fa/login-verify', { body: { challengeToken: ch, code: authenticator.generate('JBSWY3DPEHPK3PXP') } });
  check('a not-yet-migrated plaintext secret still works (and was plain before)', before === 'JBSWY3DPEHPK3PXP' && ok.status === 201, String(ok.status));
}

// ------------------------------------------------------------------ staff bank account
{
  const staffLogin = await raw('POST', '/auth/login', { body: { email: 'ayo.bello@demo.alnajoum.travel', password: DEMO } });
  const t = staffLogin.data?.accessToken;
  const set = await raw('PATCH', '/visa/payouts/me/bank-details', { token: t, body: { bankName: 'Test Bank', bankAccountNumber: '0123456789', bankAccountName: 'Ayo Bello' } });
  const stored = sql(`select "bankAccountNumber" from staff s join identities i on i.id=s."identityId" where i.email='ayo.bello@demo.alnajoum.travel'`);
  check('a staff payout account number is stored encrypted', set.status === 200 && stored.startsWith('enc:v1:') && !stored.includes('0123456789'), stored.slice(0, 18) + '...');
  const finance = (await raw('POST', '/auth/login', { body: { email: 'ibrahim.musa@demo.alnajoum.travel', password: DEMO } })).data.accessToken;
  const list = await raw('GET', '/finance/staff-bank-accounts/unverified', { token: finance });
  const mine = (list.data ?? []).find((r) => r.employeeCode && r.bankAccountName === 'Ayo Bello');
  check('the verifier still sees the real number to check against the bank', mine?.bankAccountNumber === '0123456789', mine?.bankAccountNumber);
}

// ------------------------------------------------------------------ public throttles
{
  const statuses = [];
  for (let i = 0; i < 26; i++) statuses.push((await raw('POST', '/flights/search', { body: {} })).status);
  check('unauthenticated flight search is rate-limited (429 after 20/min)', statuses.includes(429) && statuses.slice(0, 20).every((s) => s !== 429), statuses.filter((s) => s === 429).length + ' x 429');
  const v = [];
  for (let i = 0; i < 26; i++) v.push((await raw('GET', '/staff/verify/NOPE-' + i)).status);
  check('staff badge lookup is rate-limited', v.includes(429), v.filter((s) => s === 429).length + ' x 429');
}

// ------------------------------------------------------------------ bodies that used to bypass validation
{
  const admin = (await raw('POST', '/auth/login', { body: { email: 'chidi.eze@demo.alnajoum.travel', password: DEMO } })).data.accessToken;
  const made = await raw('POST', '/crm/campaigns', { token: admin, body: { name: 'Hardening check', targetService: 'FLIGHT', startDate: '2026-12-01' } });
  check('campaign create: validated body is accepted', made.status === 201 && !!made.data?.id, String(made.status));
  const badCreate = await raw('POST', '/crm/campaigns', { token: admin, body: { name: 'x', targetService: 'FLIGHT', startDate: '2026-12-01', status: 'ACTIVE', id: 'forced' } });
  check('campaign create: mass-assignment of status/id is rejected', badCreate.status === 400, String(badCreate.status));
  const cid = made.data?.id ?? 'x';
  const camp = await raw('POST', `/crm/campaigns/${cid}/status`, { token: admin, body: { status: 'BOGUS' } });
  check('campaign status: an invalid value is a 400, not a server error', camp.status === 400, String(camp.status));
  const extra = await raw('POST', `/crm/campaigns/${cid}/status`, { token: admin, body: { status: 'ACTIVE', isAdmin: true } });
  check('campaign status: unknown fields are rejected', extra.status === 400, String(extra.status));
  const other = (await raw('POST', '/auth/login', { body: { email: 'admin@zamzamhorizon.demo.alnajoum.travel', password: DEMO } })).data.accessToken;
  const foreign = await raw('POST', `/crm/campaigns/${cid}/status`, { token: other, body: { status: 'ACTIVE' } });
  check("campaign status: another company's admin gets 404 (tenant scope works, no 500)", foreign.status === 404, String(foreign.status));
  const ok = await raw('POST', `/crm/campaigns/${cid}/status`, { token: admin, body: { status: 'ACTIVE' } });
  check('campaign status: the owner can change it', ok.status === 201 || ok.status === 200, String(ok.status));
  const lines = await raw('POST', '/finance/bank-reconciliation/lines/bulk', { token: admin, body: { lines: [{ date: 'not-a-date', description: 5, amount: 'x' }] } });
  check('bank statement bulk import: every nested line is validated', lines.status === 400, String(lines.status));
  const stage = await raw('POST', '/crm/leads/stages', { token: admin, body: { name: 'x', order: 'first' } });
  check('lead stage: a non-numeric order is a 400', stage.status === 400, String(stage.status));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exitCode = failed ? 1 : 0;
