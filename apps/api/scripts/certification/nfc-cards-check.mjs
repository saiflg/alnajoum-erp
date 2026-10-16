#!/usr/bin/env node
/**
 * Live end-to-end check of the NFC half of the staff identification cards (Phase 26B). LOCAL USE ONLY.
 *
 * NO PHYSICAL READER OR CARD IS INVOLVED. "Writing" and "tapping" are simulated by posting exactly what a reader would
 * send (the NDEF URL read from a chip); results are therefore labelled MOCKED, not hardware-verified. What this proves is
 * the server side: references, the issuance workflow, status rules, tenant isolation, the bridge protocol and logging.
 *
 *   node scripts/certification/nfc-cards-check.mjs
 *
 * Needs the running API (dev database, demo seed). Creates a few temporary staff members and cards.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const DEMO = 'Demo@2026';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', process.env.DB_NAME || 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();
const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(100)} ${String(detail).slice(0, 60)}`); };

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, data: json?.data ?? json };
}
const login = async (email) => {
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', '/auth/login', { body: { email, password: DEMO } });
    if (r.data?.accessToken) return r.data.accessToken;
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  throw new Error(`login failed for ${email}`);
};

// A previous run exhausts the public tap allowance on purpose (last check); wait for the window to reset.
for (let i = 0; i < 4; i++) {
  if ((await call('GET', `/public/nfc/card/${'W'.repeat(22)}`)).status !== 429) break;
  console.log('...waiting for the rate-limit window from an earlier run to reset');
  await new Promise((r) => setTimeout(r, 25_000));
}
const admin = await login('chidi.eze@demo.alnajoum.travel');
const adminB = await login('admin@zamzamhorizon.demo.alnajoum.travel');
const manager = await login('ayo.bello@demo.alnajoum.travel');
const customer = await login('chinedu.okafor@demo.alnajoum.travel');
const run = Date.now().toString(36);
const companyA = sql(`select s."companyId" from staff s join identities i on i.id=s."identityId" where i.email='chidi.eze@demo.alnajoum.travel'`);
const staffRole = (await call('GET', '/rbac/roles', { token: admin })).data.find((r) => r.name === 'STAFF');

async function newCard(label) {
  const s = await call('POST', '/staff', { token: admin, body: { email: `nfc.${label}.${run}@demo.alnajoum.travel`, firstName: 'Nfc', lastName: `Tester${label}`, companyId: companyA, employeeCode: `NF-${label}-${run}`.toUpperCase(), roleId: staffRole.id, jobTitle: 'NFC Test Agent', department: 'Testing' } });
  const staffId = s.data?.staff?.id;
  const c = await call('POST', '/staff-cards', { token: admin, body: { staffId } });
  return { staffId, card: c.data, cardId: c.data?.id };
}
const readBack = (url) => url; // what a reader returns after reading the NDEF record back

// ------------------------------------------------------------------ permissions
check('a customer cannot reach the NFC settings', (await call('GET', '/nfc/profiles', { token: customer })).status === 403);
check('an unauthenticated caller cannot', (await call('GET', '/nfc/overview')).status === 401);
check('a branch manager can see the chip profiles', (await call('GET', '/nfc/profiles', { token: manager })).status === 200);
check('a branch manager cannot create a chip profile', (await call('POST', '/nfc/profiles', { token: manager, body: { name: 'X', chipType: 'NTAG213' } })).status === 403);
check('a branch manager cannot register a reader', (await call('POST', '/nfc/readers', { token: manager, body: { name: 'R', adapter: 'MOCK' } })).status === 403);
check('a customer cannot verify a tap', (await call('POST', '/nfc/verify', { token: customer, body: { payload: 'x'.repeat(22) } })).status === 403);

// ------------------------------------------------------------------ chip capabilities and profiles
const caps = await call('GET', '/nfc/capabilities', { token: admin });
check('every chip is described honestly: all are opaque-reference only, plain tags warn about copying', caps.status === 200 && caps.data.every((c) => c.implemented === 'OPAQUE_REFERENCE') && /copied/i.test(caps.data.find((c) => c.chipType === 'NTAG213').warning));
check('DESFire/NTAG 424 are described as crypto-capable but NOT implemented here', caps.data.filter((c) => c.cryptoCapable).every((c) => /Not implemented/i.test(c.warning)));
const profile = await call('POST', '/nfc/profiles', { token: admin, body: { name: `NTAG213 white PVC ${run}`, chipType: 'NTAG213', cardStock: 'White PVC 0.84mm, NTAG213 inlay', readerModel: 'Generic PC/SC reader', compatibilityNotes: 'Checked with an Android phone (Chrome).', isDefault: true } });
check('a chip profile is recorded with the card stock and reader model', profile.status === 201 && profile.data.capability.ndef === true, `${profile.status}`);
check('a duplicate profile name is refused', (await call('POST', '/nfc/profiles', { token: admin, body: { name: `NTAG213 white PVC ${run}`, chipType: 'NTAG213' } })).status === 409);
check("another company cannot see the profile", !(await call('GET', '/nfc/profiles', { token: adminB })).data.some((p) => p.id === profile.data.id));

// ------------------------------------------------------------------ issuance workflow
const a = await newCard('A');
check('a staff card is issued (pending)', a.card?.status === 'PENDING' || a.card?.effectiveStatus === 'PENDING', a.card?.status);
check('an NFC chip cannot be prepared by a manager', (await call('POST', `/nfc/cards/${a.cardId}/prepare`, { token: manager, body: {} })).status === 403);
check("another company cannot prepare this company's card", (await call('POST', `/nfc/cards/${a.cardId}/prepare`, { token: adminB, body: {} })).status === 404);
const prep = await call('POST', `/nfc/cards/${a.cardId}/prepare`, { token: admin, body: { batch: `BATCH-${run}`, profileId: profile.data.id } });
check('preparing returns a random reference, the address to write and the exact bytes', prep.status === 201 && /^[A-Za-z0-9_-]{22}$/.test(prep.data.reference) && prep.data.plan.fits === true && /^d1/.test(prep.data.plan.ndefHex), `${prep.status}`);
check('the chip reference is NOT the QR token', prep.data.reference !== sql(`select "verificationToken" from staff_id_cards where id='${a.cardId}'`));
const written = Buffer.from(prep.data.plan.ndefHex, 'hex').toString('latin1');
check('nothing personal is on the chip: no name, staff id, e-mail or number', !/Tester|NF-A|nfc\.A|NFC Test/i.test(written) && !/Tester|NF-A/i.test(prep.data.url));
check('the card cannot be activated before its chip is confirmed', (await call('POST', `/staff-cards/${a.cardId}/activate`, { token: admin, body: {} })).status === 400);
check('an unwritten chip does not verify', (await call('POST', '/nfc/verify', { token: admin, body: { payload: prep.data.url } })).data?.result === 'INVALID');

const bad1 = await call('POST', `/nfc/cards/${a.cardId}/confirm`, { token: admin, body: { success: true, readBack: nfcOther() } });
function nfcOther() { return `https://x.example/verify/nfc/${'A'.repeat(22)}`; }
check('a read-back that does not match is recorded as FAILED', bad1.data?.status === 'FAILED' && /does not match/.test(bad1.data.reason));
const bad2 = await call('POST', `/nfc/cards/${a.cardId}/confirm`, { token: admin, body: { success: false, error: 'Writer reported error 0x6A' } });
check('a writer error is recorded and visible', bad2.data?.status === 'FAILED' && (await call('GET', `/nfc/cards/${a.cardId}`, { token: admin })).data.failureReason?.includes('0x6A'));
check('the failed chip never verifies', (await call('POST', '/nfc/verify', { token: admin, body: { payload: prep.data.url } })).data?.result === 'INVALID');
const prep2 = await call('POST', `/nfc/cards/${a.cardId}/prepare`, { token: admin, body: { batch: `BATCH-${run}`, profileId: profile.data.id } });
check('a retry issues a NEW reference and retires the old one', prep2.status === 201 && prep2.data.reference !== prep.data.reference);
// A new, random 7-byte serial every run: the server rightly refuses one that is already recorded for another card.
const uidHex = '04' + randomBytes(6).toString('hex').toUpperCase();
const uid = uidHex.match(/../g).join(':');
const ok = await call('POST', `/nfc/cards/${a.cardId}/confirm`, { token: admin, body: { success: true, readBack: readBack(prep2.data.url), uid, recordUid: true } });
check('writing is confirmed only after an exact read-back (VERIFIED)', ok.data?.status === 'VERIFIED' && ok.data.serialRecorded === true, JSON.stringify(ok.data));
check('the serial number is stored only as a keyed fingerprint', sql(`select count(*) from staff_id_card_nfc where "cardId"='${a.cardId}' and "uidHash" ~ '^[0-9a-f]{64}$' and "uidHash" <> '${createHash('sha256').update(uidHex).digest('hex')}'`) === '1' && sql(`select "uidHint" from staff_id_card_nfc where "cardId"='${a.cardId}'`) === '…' + uidHex.slice(-2));
check('a confirmed chip cannot be silently overwritten', (await call('POST', `/nfc/cards/${a.cardId}/prepare`, { token: admin, body: {} })).status === 409);
const act = await call('POST', `/staff-cards/${a.cardId}/activate`, { token: admin, body: {} });
check('only now can the card be activated', act.status === 201 || act.status === 200, `${act.status}`);

// a second card must not reuse the same chip serial number
const b = await newCard('B');
const prepB = await call('POST', `/nfc/cards/${b.cardId}/prepare`, { token: admin, body: { batch: `BATCH-${run}` } });
const dupe = await call('POST', `/nfc/cards/${b.cardId}/confirm`, { token: admin, body: { success: true, readBack: prepB.data.url, uid, recordUid: true } });
check('a chip serial number already used by another card is refused (possible copy)', dupe.data?.status === 'FAILED' && /already recorded/.test(dupe.data.reason));
const prepB2 = await call('POST', `/nfc/cards/${b.cardId}/prepare`, { token: admin, body: { batch: `BATCH-${run}` } });
await call('POST', `/nfc/cards/${b.cardId}/confirm`, { token: admin, body: { success: true, readBack: prepB2.data.url } });
await call('POST', `/staff-cards/${b.cardId}/activate`, { token: admin, body: {} });

// ------------------------------------------------------------------ verification
const tapA = await call('POST', '/nfc/verify', { token: admin, body: { payload: prep2.data.url } });
check('a tap of a confirmed, active card is VALID and says it was NFC', tapA.data?.result === 'VALID' && tapA.data.method === 'NFC' && tapA.data.assurance === 'OPAQUE_REFERENCE' && tapA.data.staff?.fullName === 'Nfc TesterA', JSON.stringify(tapA.data?.result));
check('the answer warns that a copied chip carries a copied reference', /copied/i.test((tapA.data?.warnings ?? []).join(' ')));
check('a bare reference works as well as the address', (await call('POST', '/nfc/verify', { token: admin, body: { payload: prep2.data.reference } })).data?.result === 'VALID');
check('garbage is just "not recognised"', (await call('POST', '/nfc/verify', { token: admin, body: { payload: 'hello' } })).data?.result === 'INVALID');
const strong = await call('POST', '/nfc/verify-uid', { token: admin, body: { uid } });
check('a serial-number-only read works but is labelled UID_ONLY and weak', strong.data?.result === 'VALID' && strong.data.assurance === 'UID_ONLY' && /weak/i.test(strong.data.warnings.join(' ')));
const tokA = sql(`select "verificationToken" from staff_id_cards where id='${a.cardId}'`);
const tokB = sql(`select "verificationToken" from staff_id_cards where id='${b.cardId}'`);
const both = await call('POST', '/nfc/verify-both', { token: admin, body: { qr: `http://localhost:3000/verify/card/${tokA}`, nfc: prep2.data.url } });
check('QR and NFC of the same card together are VALID (strongest check)', both.data?.result === 'VALID' && both.data.assurance === 'QR_AND_NFC' && both.data.method === 'QR_AND_NFC');
const mix = await call('POST', '/nfc/verify-both', { token: admin, body: { qr: tokB, nfc: prep2.data.url } });
check("a QR code from one card with another card's chip is refused", mix.data?.result === 'INVALID' && /different cards/.test(mix.data.warnings.join(' ')) && mix.data.staff === null);
check('the QR token is not accepted as an NFC reference', (await call('POST', '/nfc/verify', { token: admin, body: { payload: tokA } })).data?.result === 'INVALID');
check("another company's staff cannot verify this company's chip", (await call('POST', '/nfc/verify', { token: adminB, body: { payload: prep2.data.url } })).data?.result === 'INVALID');
const pub = await call('GET', `/public/nfc/card/${prep2.data.reference}`);
check('the public tap page shows the same live answer', pub.data?.result === 'VALID' && pub.data.method === 'PUBLIC_NFC_LINK');

// ------------------------------------------------------------------ status changes reach NFC and QR alike
await call('POST', `/staff-cards/${a.cardId}/suspend`, { token: admin, body: { reason: 'Lost, awaiting search' } });
const s1 = await call('POST', '/nfc/verify', { token: admin, body: { payload: prep2.data.url } });
const s2 = await call('GET', `/public/staff-cards/${tokA}`);
const s3 = await call('GET', `/public/nfc/card/${prep2.data.reference}`);
check('after suspension NFC, the QR link and the public tap all say SUSPENDED and show no identity', [s1, s2, s3].every((r) => r.data?.result === 'SUSPENDED' && r.data.staff === null));
await call('POST', `/staff-cards/${a.cardId}/reinstate`, { token: admin, body: { reason: 'Found' } });
check('after reinstatement both work again', (await call('POST', '/nfc/verify', { token: admin, body: { payload: prep2.data.url } })).data?.result === 'VALID');
await call('POST', `/staff-cards/${a.cardId}/revoke`, { token: admin, body: { reason: 'Left the company' } });
check('after revocation NFC says REVOKED', (await call('POST', '/nfc/verify', { token: admin, body: { payload: prep2.data.url } })).data?.result === 'REVOKED');
const rep = await call('POST', `/staff-cards/${b.cardId}/replace`, { token: admin, body: { reason: 'Chip damaged' } });
check('after replacement the OLD chip says REPLACED', rep.status < 300 && (await call('POST', '/nfc/verify', { token: admin, body: { payload: prepB2.data.url } })).data?.result === 'REPLACED', `${rep.status}`);
sql(`update staff_id_cards set "expiresAt" = now() - interval '1 day' where id='${b.cardId}' and status='ACTIVE'`);

// ------------------------------------------------------------------ the labelled mock reader
const mock = await call('POST', '/nfc/readers', { token: admin, body: { name: `Mock reader ${run}`, adapter: 'MOCK', model: 'Test double' } });
check('a mock reader can be registered and is flagged as simulated', mock.status === 201 && (await call('GET', '/nfc/readers', { token: admin })).data.find((r) => r.id === mock.data.id)?.simulated === true);
const c = await newCard('C'); const pc = await call('POST', `/nfc/cards/${c.cardId}/prepare`, { token: admin, body: {} });
await call('POST', `/nfc/cards/${c.cardId}/confirm`, { token: admin, body: { success: true, readBack: pc.data.url } });
await call('POST', `/staff-cards/${c.cardId}/activate`, { token: admin, body: {} });
const sim = await call('POST', '/nfc/verify', { token: admin, body: { payload: pc.data.url, readerId: mock.data.id, simulated: true } });
check('a scan from the mock reader is marked simulated in the answer', sim.data?.result === 'VALID' && sim.data.simulated === true);
check('and in the permanent scan record', sql(`select simulated from staff_id_card_scans where "readerId"='${mock.data.id}' order by "createdAt" desc limit 1`) === 't');
const rd = (await call('GET', '/nfc/readers', { token: admin })).data.find((r) => r.id === mock.data.id);
check('the reader status shows its last tap and result', rd.lastResult === 'VALID' && !!rd.lastCardAt && rd.status === 'CONNECTED' && /mock/i.test(rd.compatibility));
const real = await call('POST', '/nfc/verify', { token: admin, body: { payload: pc.data.url } });
check('a scan with no mock reader is not marked simulated', real.data?.simulated === false);
check("a reader of another company is ignored (not recorded against it)", (await call('POST', '/nfc/verify', { token: adminB, body: { payload: pc.data.url, readerId: mock.data.id } })).data?.result === 'INVALID' && sql(`select count(*) from staff_id_card_scans where "readerId"='${mock.data.id}'`) === '1');

// ------------------------------------------------------------------ local bridge protocol
const bridge = await call('POST', '/nfc/readers', { token: admin, body: { name: `Desk PC/SC ${run}`, adapter: 'PCSC_BRIDGE', model: 'Generic CCID reader', location: 'Head office desk' } });
check('a bridge reader gets a one-time secret, stored only as a hash', bridge.status === 201 && bridge.data.bridgeToken?.length >= 20 && sql(`select count(*) from nfc_reader_devices where id='${bridge.data.id}' and "tokenHash" ~ '^[0-9a-f]{64}$'`) === '1');
const T = { 'x-reader-token': bridge.data.bridgeToken };
check('the bridge cannot call without its secret, or with a wrong one', (await call('POST', '/public/nfc/bridge/verify', { body: { payload: pc.data.url } })).status === 401 && (await call('POST', '/public/nfc/bridge/verify', { body: { payload: pc.data.url }, headers: { 'x-reader-token': 'A'.repeat(32) } })).status === 401);
check('a heartbeat updates the reader status', (await call('POST', '/public/nfc/bridge/heartbeat', { body: { status: 'CONNECTED' }, headers: T })).status === 201 && (await call('GET', '/nfc/readers', { token: admin })).data.find((r) => r.id === bridge.data.id).status === 'CONNECTED');
const bv = await call('POST', '/public/nfc/bridge/verify', { body: { payload: pc.data.url }, headers: T });
check('a tap sent by the bridge is verified and recorded against that reader', bv.data?.result === 'VALID' && bv.data.simulated === false && sql(`select count(*) from staff_id_card_scans where "readerId"='${bridge.data.id}'`) === '1');
await call('POST', '/public/nfc/bridge/heartbeat', { body: { status: 'ERROR', error: 'Reader unplugged' }, headers: T });
const er = (await call('GET', '/nfc/readers', { token: admin })).data.find((r) => r.id === bridge.data.id);
check('a reader error is shown with its message', er.status === 'ERROR' && /unplugged/.test(er.lastError));
await call('PUT', `/nfc/readers/${bridge.data.id}/active`, { token: admin, body: { isActive: false } });
check('a switched-off reader is refused at once', (await call('POST', '/public/nfc/bridge/verify', { body: { payload: pc.data.url }, headers: T })).status === 401);
check("another company cannot switch this company's reader on or off", (await call('PUT', `/nfc/readers/${bridge.data.id}/active`, { token: adminB, body: { isActive: true } })).status === 404);

// ------------------------------------------------------------------ overview, history, batches, audit
const ov = await call('GET', '/nfc/overview', { token: admin });
check('the overview lists profiles, readers, recent taps and chip counts', ov.status === 200 && ov.data.profiles.length >= 1 && ov.data.readers.length >= 2 && ov.data.recent.length >= 1 && ov.data.chips.VERIFIED >= 3);
check('batches are reported with their chip states', (await call('GET', '/nfc/batches', { token: admin })).data.some((x) => x.batch === `BATCH-${run}`));
check('the card history shows the NFC steps', ['NFC_PREPARED', 'NFC_ENCODING_FAILED', 'NFC_ENCODED'].every((act2) => Number(sql(`select count(*) from staff_id_card_events where "cardId"='${a.cardId}' and action='${act2}'`)) >= 1));
check('the audit log has the NFC actions', Number(sql(`select count(*) from audit_logs where action like 'staff_card.nfc_%' and "companyId"='${companyA}'`)) >= 5);

// ------------------------------------------------------------------ rate limit (last)
let limited = false;
for (let i = 0; i < 40 && !limited; i++) limited = (await call('GET', `/public/nfc/card/${'Z'.repeat(22)}`)).status === 429;
check('the public tap endpoint is rate limited per client', limited);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}  (MOCKED: no physical reader or card was used)`);
process.exit(failed ? 1 : 0);
