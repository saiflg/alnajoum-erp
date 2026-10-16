#!/usr/bin/env node
/**
 * Live end-to-end check of the staff identification card module (Phase 26, Module A). LOCAL USE ONLY: it creates a
 * temporary staff member and cards in the development database. Needs a running API and the demo seed.
 *
 *   node scripts/certification/staff-cards-check.mjs
 *
 * The public-verification rate-limit test runs last and deliberately exhausts the limit for this machine's address
 * for one minute.
 */
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const DEMO = 'Demo@2026';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', process.env.DB_NAME || 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();

const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(92)} ${String(detail).slice(0, 80)}`); };

async function call(method, path, { token, body, form, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, data: json?.data ?? json, headers: res.headers };
}
const login = async (email, password = DEMO) => {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (!r.data?.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.data.accessToken;
};

// a small genuine PNG (valid signature, real pixels) for the photograph
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w = 96, h = 120) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 13 + (x % 5) * 31) & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const upload = (bytes) => { const f = new FormData(); f.append('file', new Blob([bytes], { type: 'image/png' }), 'photo.png'); return f; };

// A previous run of this script exhausts the public-verification allowance on purpose; wait for it to reset.
for (let i = 0; i < 3; i++) {
  if ((await call('GET', `/public/staff-cards/${'W'.repeat(22)}`)).status !== 429) break;
  console.log('...waiting for the rate-limit window from an earlier run to reset');
  await new Promise((r) => setTimeout(r, 25_000));
}
const adminA = await login('chidi.eze@demo.alnajoum.travel');
const adminB = await login('admin@zamzamhorizon.demo.alnajoum.travel');
const branchManager = await login('ayo.bello@demo.alnajoum.travel');
const customer = await login('chinedu.okafor@demo.alnajoum.travel');
const companyA = sql(`select s."companyId" from staff s join identities i on i.id=s."identityId" where i.email='chidi.eze@demo.alnajoum.travel'`);
const run = Date.now().toString(36);

// ------------------------------------------------------------------ a temporary staff member to issue a card to
const roles = (await call('GET', '/rbac/roles', { token: adminA })).data;
const staffRole = roles.find((r) => r.name === 'STAFF');
const created = await call('POST', '/staff', { token: adminA, body: { email: `card.${run}@demo.alnajoum.travel`, firstName: 'Card', lastName: 'Tester', companyId: companyA, employeeCode: `CT-${run}`.toUpperCase(), roleId: staffRole.id, jobTitle: 'Test Agent', department: 'Testing' } });
const staffId = created.data?.staff?.id;
const tempPassword = created.data?.temporaryPassword;
check('a temporary staff member is created for the test', created.status === 201 && !!staffId, `${created.status}`);

// ------------------------------------------------------------------ permissions
const staffUser = await login(`card.${run}@demo.alnajoum.travel`, tempPassword); // an ordinary STAFF-role login
check('a customer cannot reach the card admin API', (await call('GET', '/staff-cards/dashboard', { token: customer })).status === 403);
check('an ordinary staff member cannot see the card list or the dashboard', (await call('GET', '/staff-cards', { token: staffUser })).status === 403 && (await call('GET', '/staff-cards/dashboard', { token: staffUser })).status === 403);
check('an ordinary staff member can use the scanner', (await call('POST', '/staff-cards/verify', { token: staffUser, body: { method: 'MANUAL_REFERENCE', value: 'ALN-C-0000-0000' } })).status === 201);
check('a branch manager can see cards but cannot issue one', (await call('GET', '/staff-cards', { token: branchManager })).status === 200 && (await call('POST', '/staff-cards', { token: branchManager, body: { staffId } })).status === 403);
check('an ordinary staff member cannot issue a card', (await call('POST', '/staff-cards', { token: staffUser, body: { staffId } })).status === 403);
check('an anonymous caller cannot issue a card', (await call('POST', '/staff-cards', { body: { staffId } })).status === 401);

// ------------------------------------------------------------------ issue (pending) and activate
const issued = await call('POST', '/staff-cards', { token: adminA, body: { staffId } });
const card = issued.data;
check('an administrator issues a card; it starts PENDING', issued.status === 201 && card?.status === 'PENDING', `${issued.status} ${card?.status} ${card?.cardNumber}`);
check('the card number is unique and readable', /^ALN-C-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(card?.cardNumber ?? ''));
const second = await call('POST', '/staff-cards', { token: adminA, body: { staffId } });
check('a second live card for the same person is refused', second.status === 409, `${second.status}`);
const own = sql(`select s.id from staff s join identities i on i.id=s."identityId" where i.email='chidi.eze@demo.alnajoum.travel'`);
check('an administrator cannot issue a card to themselves', (await call('POST', '/staff-cards', { token: adminA, body: { staffId: own } })).status === 403);

let preview = (await call('GET', `/staff-cards/${card.id}/preview`, { token: adminA })).data;
const token1 = preview.verifyUrl.split('/verify/card/')[1];
check('the QR payload is a verification link with an unguessable 22-character code', /^[A-Za-z0-9_-]{22}$/.test(token1), preview.verifyUrl);
check('the QR code contains no personal data, only the link', !/Tester|CT-|Testing/i.test(preview.verifyUrl) && preview.verifyUrl.split('/verify/card/')[1].length === 22);
check('the preview carries a QR image and the printed fields', preview.qrDataUrl?.startsWith('data:image/png;base64,') && preview.fullName === 'Card Tester' && preview.employeeCode === `CT-${run}`.toUpperCase());

let pub = (await call('GET', `/public/staff-cards/${token1}`)).data;
check('a PENDING card does not vouch for anyone (INVALID)', pub.result === 'INVALID' && pub.staff === null, pub.label);

const activated = await call('POST', `/staff-cards/${card.id}/activate`, { token: adminA });
check('activating makes it ACTIVE', activated.data?.status === 'ACTIVE', activated.data?.status);

// ------------------------------------------------------------------ public verification
const anon = await call('GET', `/public/staff-cards/${token1}`);
pub = anon.data;
check('anyone can scan: VALID — ACTIVE CARD with name, staff id, department', anon.status === 200 && pub.result === 'VALID' && pub.label === 'VALID — ACTIVE CARD' && pub.staff?.fullName === 'Card Tester' && pub.staff?.department === 'Testing', pub.label);
check('the public answer contains no email, phone, bank or role data', !/@|bank|phone|salary|identityId|companyId/i.test(JSON.stringify(pub)));
check('a copied QR code cannot be used as a login credential', (await call('GET', '/staff-cards/dashboard', { token: token1 })).status === 401);
check('...nor on a data endpoint', (await call('GET', '/invoices', { token: token1 })).status === 401);

// photograph
const photo = await call('POST', `/staff-cards/staff/${staffId}/photo`, { token: adminA, form: upload(png()) });
check('a photograph is uploaded, re-encoded and stored', photo.status === 201 && photo.data?.hasPhoto === true, `${photo.status}`);
const photoStaff = sql(`select "photoFilename" from staff where id='${staffId}'`);
check('the stored photo is a re-encoded JPEG, not the uploaded file', /\.jpg$/.test(photoStaff), photoStaff);
const pubPhoto = await call('GET', `/public/staff-cards/${token1}/photo`, { raw: true });
check('the photograph is shown for a valid card', pubPhoto.status === 200 && pubPhoto.headers.get('content-type') === 'image/jpeg' && pubPhoto.buffer[0] === 0xff);
const fake = new FormData(); fake.append('file', new Blob([Buffer.from('<html><script>alert(1)</script></html>')], { type: 'image/png' }), 'x.png');
check('HTML disguised as a photograph is rejected', (await call('POST', `/staff-cards/staff/${staffId}/photo`, { token: adminA, form: fake })).status === 400);

// ------------------------------------------------------------------ print
const pdf = await call('GET', `/staff-cards/${card.id}/pdf`, { token: adminA, raw: true });
check('a print-ready PDF is produced (front and back)', pdf.status === 200 && pdf.buffer.subarray(0, 4).toString() === '%PDF' && (pdf.buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length === 2, `${pdf.buffer.length} bytes`);
const sheet = await call('POST', '/staff-cards/print', { token: adminA, body: { cardIds: [card.id], layout: 'sheet' }, raw: true });
check('an A4 sheet layout with cut guides is produced', sheet.status === 201 && sheet.buffer.subarray(0, 4).toString() === '%PDF');
check('printing is recorded in the card history', Number(sql(`select count(*) from staff_id_card_events where "cardId"='${card.id}' and action='PRINTED'`)) >= 1 && Number(sql(`select "printedCount" from staff_id_cards where id='${card.id}'`)) >= 1);
const mine = await call('GET', '/staff-cards/mine', { token: staffUser, raw: true });
check('a staff member can download their own card as a PDF', mine.status === 200 && mine.buffer.subarray(0, 4).toString() === '%PDF');
check('a staff member without a card is told so (404)', (await call('GET', '/staff-cards/mine', { token: branchManager })).status === 404);

// ------------------------------------------------------------------ lifecycle
const noReason = await call('POST', `/staff-cards/${card.id}/suspend`, { token: adminA, body: { reason: '' } });
check('suspending without a reason is refused', noReason.status === 400, `${noReason.status}`);
const susp = await call('POST', `/staff-cards/${card.id}/suspend`, { token: adminA, body: { reason: 'Under review' } });
check('suspend: status SUSPENDED', susp.data?.status === 'SUSPENDED');
pub = (await call('GET', `/public/staff-cards/${token1}`)).data;
check('the same QR now reads SUSPENDED — CARD SUSPENDED, with no identity shown', pub.result === 'SUSPENDED' && pub.label === 'SUSPENDED — CARD SUSPENDED' && pub.staff === null && !JSON.stringify(pub).includes('Tester'), pub.label);
check('...and no photograph is served', (await call('GET', `/public/staff-cards/${token1}/photo`, { raw: true })).status === 404);
check('a suspended card cannot be printed', (await call('POST', '/staff-cards/print', { token: adminA, body: { cardIds: [card.id] }, raw: true })).status === 400);
const rein = await call('POST', `/staff-cards/${card.id}/reinstate`, { token: adminA, body: { reason: 'Cleared' } });
check('reinstate: back to ACTIVE, VALID again on the same QR', rein.data?.status === 'ACTIVE' && (await call('GET', `/public/staff-cards/${token1}`)).data.result === 'VALID');
const renewed = await call('POST', `/staff-cards/${card.id}/renew`, { token: adminA, body: { validityMonths: 36 } });
check('renew extends the expiry date', new Date(renewed.data?.expiresAt) > new Date(card.expiresAt), `${card.expiresAt?.slice(0, 10)} -> ${renewed.data?.expiresAt?.slice(0, 10)}`);

// expired: set the date in the past (the live check must not depend on a nightly job)
sql(`update staff_id_cards set "expiresAt"=now() - interval '1 day' where id='${card.id}'`);
pub = (await call('GET', `/public/staff-cards/${token1}`)).data;
check('past its expiry date the QR reads EXPIRED — CARD EXPIRED at once', pub.result === 'EXPIRED' && pub.label === 'EXPIRED — CARD EXPIRED' && pub.staff === null, pub.label);
check('an expired card cannot be suspended (must be renewed)', (await call('POST', `/staff-cards/${card.id}/suspend`, { token: adminA, body: { reason: 'x1x' } })).status === 409);
const sweep = await call('POST', '/staff-cards/maintenance/sweep', { token: adminA });
check('the daily sweep records the expiry in the history', sweep.status === 201 && sweep.data.expired >= 1 && sql(`select status from staff_id_cards where id='${card.id}'`) === 'EXPIRED', JSON.stringify(sweep.data));
const rn2 = await call('POST', `/staff-cards/${card.id}/renew`, { token: adminA, body: {} });
check('renewing an expired card makes it ACTIVE and VALID again', rn2.data?.status === 'ACTIVE' && (await call('GET', `/public/staff-cards/${token1}`)).data.result === 'VALID');

// replace
const repl = await call('POST', `/staff-cards/${card.id}/replace`, { token: adminA, body: { reason: 'Card lost' } });
const card2 = repl.data;
check('replace: a new ACTIVE card is issued with a new number', repl.status === 201 && card2?.status === 'ACTIVE' && card2.cardNumber !== card.cardNumber, card2?.cardNumber);
pub = (await call('GET', `/public/staff-cards/${token1}`)).data;
check('the OLD QR now reads REPLACED — OLD CARD REPLACED', pub.result === 'REPLACED' && pub.label === 'REPLACED — OLD CARD REPLACED' && pub.staff === null, pub.label);
const token2 = (await call('GET', `/staff-cards/${card2.id}/preview`, { token: adminA })).data.verifyUrl.split('/verify/card/')[1];
check('the NEW card has a different, working code', token2 !== token1 && (await call('GET', `/public/staff-cards/${token2}`)).data.result === 'VALID');
check('the replacement is linked to the old card', sql(`select "replacedByCardId" from staff_id_cards where id='${card.id}'`) === card2.id);

// history
const hist = (await call('GET', `/staff-cards/${card.id}/history`, { token: adminA })).data;
const actions = hist.map((h) => h.action);
check('the history lists every action, with actor and reason where given', ['ISSUED', 'ACTIVATED', 'SUSPENDED', 'REINSTATED', 'RENEWED', 'EXPIRED', 'PRINTED', 'REPLACED'].every((a) => actions.includes(a)), actions.join(','));
check('...each recorded with who did it', hist.filter((h) => h.action !== 'EXPIRED').every((h) => !!h.actorIdentityId) && hist.find((h) => h.action === 'SUSPENDED').reason === 'Under review');

// revoke + manual lookups
const manualRef = await call('POST', '/staff-cards/verify', { token: staffUser, body: { method: 'MANUAL_REFERENCE', value: card2.cardNumber.toLowerCase() } });
check('manual lookup by card reference (any case) works for a staff member', manualRef.data?.result === 'VALID', manualRef.data?.label);
const manualId = await call('POST', '/staff-cards/verify', { token: staffUser, body: { method: 'MANUAL_STAFF_ID', value: `CT-${run}`.toUpperCase() } });
check('manual lookup by staff id works', manualId.data?.result === 'VALID', manualId.data?.label);
const viaQr = await call('POST', '/staff-cards/verify', { token: staffUser, body: { method: 'QR', value: preview.verifyUrl.replace(token1, token2) } });
check('the scanner accepts the full scanned link', viaQr.data?.result === 'VALID');
check('the scanner rejects text that is not a card code', (await call('POST', '/staff-cards/verify', { token: staffUser, body: { method: 'QR', value: 'https://evil.example/x' } })).data?.result === 'INVALID');
check("another company's scanner cannot see this company's card by reference or staff id", (await call('POST', '/staff-cards/verify', { token: adminB, body: { method: 'MANUAL_REFERENCE', value: card2.cardNumber } })).data?.result === 'INVALID' && (await call('POST', '/staff-cards/verify', { token: adminB, body: { method: 'MANUAL_STAFF_ID', value: `CT-${run}`.toUpperCase() } })).data?.result === 'INVALID');

// tenant isolation
check("another company cannot read, change or print this company's card (404)", (await call('GET', `/staff-cards/${card2.id}`, { token: adminB })).status === 404 && (await call('POST', `/staff-cards/${card2.id}/revoke`, { token: adminB, body: { reason: 'attack' } })).status === 404 && (await call('GET', `/staff-cards/${card2.id}/pdf`, { token: adminB, raw: true })).status === 404);
const listB = (await call('GET', '/staff-cards?pageSize=100', { token: adminB })).data;
check("another company's list contains none of this company's cards", !JSON.stringify(listB).includes(card2.cardNumber));
check("another company cannot issue a card to this company's staff", (await call('POST', '/staff-cards', { token: adminB, body: { staffId } })).status === 404);
check("another company cannot upload a photograph for this company's staff", (await call('POST', `/staff-cards/staff/${staffId}/photo`, { token: adminB, form: upload(png()) })).status === 404);

// dashboard + list
const dash = (await call('GET', '/staff-cards/dashboard', { token: adminA })).data;
check('the dashboard has real counts', ['total', 'active', 'expiringSoon', 'expired', 'suspended', 'revoked', 'replaced'].every((k) => typeof dash[k] === 'number') && dash.total >= 2 && dash.replaced >= 1, JSON.stringify({ t: dash.total, a: dash.active, r: dash.replaced }));
const list = (await call('GET', `/staff-cards?search=${encodeURIComponent('Card')}&pageSize=5`, { token: adminA })).data;
check('search and pagination work', list.total >= 2 && list.items.length <= 5 && list.items.every((i) => i.staff.fullName === 'Card Tester'), `${list.total} found`);
const byStatus = (await call('GET', '/staff-cards?status=REPLACED', { token: adminA })).data;
check('filter by status works', byStatus.items.length >= 1 && byStatus.items.every((i) => i.effectiveStatus === 'REPLACED'));
check('the list never exposes verification codes', !JSON.stringify(list).includes(token2));
const scanHist = (await call('GET', '/staff-cards/scans?pageSize=50', { token: staffUser })).data;
check('scan history is available to scanners, with the result and how it was checked', scanHist.total > 0 && scanHist.items.some((s) => s.method === 'MANUAL_REFERENCE') , `${scanHist.total} scans`);
check('the scan log stores no raw IP address', Number(sql(`select count(*) from staff_id_card_scans where "ipFingerprint" ~ '^[0-9.:]+$'`)) === 0 && Number(sql(`select count(*) from staff_id_card_scans where "ipFingerprint" ~ '^[0-9a-f]{64}$'`)) > 0);

// staff leaves
const rev = await call('POST', `/staff-cards/${card2.id}/revoke`, { token: adminA, body: { reason: 'Left the company' } });
check('revoke: the QR reads REVOKED — CARD REVOKED', rev.data?.status === 'REVOKED' && (await call('GET', `/public/staff-cards/${token2}`)).data.label === 'REVOKED — CARD REVOKED');
const card3 = (await call('POST', '/staff-cards', { token: adminA, body: { staffId, activateNow: true } })).data;
const token3 = (await call('GET', `/staff-cards/${card3.id}/preview`, { token: adminA })).data.verifyUrl.split('/verify/card/')[1];
check('after a revoke a fresh card can be issued', card3?.status === 'ACTIVE' && (await call('GET', `/public/staff-cards/${token3}`)).data.result === 'VALID');
const del = await call('DELETE', `/staff/${staffId}`, { token: adminA });
await new Promise((r) => setTimeout(r, 800));
check('deactivating the staff member revokes their card automatically', del.status < 300 && sql(`select status from staff_id_cards where id='${card3.id}'`) === 'REVOKED' && (await call('GET', `/public/staff-cards/${token3}`)).data.result === 'REVOKED');
check('...and the history is kept, with the reason', Number(sql(`select count(*) from staff_id_card_events where "cardId"='${card3.id}' and action='STAFF_DEACTIVATED'`)) === 1 && Number(sql(`select count(*) from staff_id_cards where "staffId"='${staffId}'`)) === 3);

// settings
const set = await call('PUT', '/staff-cards/settings', { token: adminA, body: { tagline: 'Your Journey, Our Priority', primaryColor: '#123456', lostCardNotice: 'Lost? Call the office at once.' } });
check('card design settings can be changed by an administrator', set.status === 200 && set.data.primaryColor === '#123456', `${set.status}`);
check('a bad colour is rejected', (await call('PUT', '/staff-cards/settings', { token: adminA, body: { primaryColor: 'red' } })).status === 400);
check('a branch manager can read the design but not change it', (await call('PUT', '/staff-cards/settings', { token: branchManager, body: { tagline: 'x' } })).status === 403);
const logo = await call('POST', '/staff-cards/settings/logo', { token: adminA, form: upload(png(200, 100)) });
check('a company logo can be uploaded', logo.status === 201, `${logo.status}`);
check('no registration or accreditation text is printed unless the company supplies it', (await call('GET', '/staff-cards/settings', { token: adminA })).data.officialRegistrationLine === null);
await call('PUT', '/staff-cards/settings', { token: adminA, body: { primaryColor: '#0f172a', tagline: '' } });

// legacy, enumerable endpoint is gone
check('the old public lookup by employee code no longer exists', (await call('GET', '/staff/verify/SA-0001')).status === 401 || (await call('GET', '/staff/verify/SA-0001')).status === 404);

// ------------------------------------------------------------------ malformed and unknown codes
const unknown = await call('GET', `/public/staff-cards/${'A'.repeat(22)}`);
const malformed = await call('GET', `/public/staff-cards/${encodeURIComponent("' OR 1=1 --")}`);
check('an unknown code and a malformed one answer alike, with the same status', unknown.status === malformed.status && unknown.data.result === 'INVALID' && malformed.data.result === 'INVALID' && unknown.data.label === 'INVALID — CARD NOT RECOGNIZED');

// ------------------------------------------------------------------ rate limiting (last)
let limited = 0;
for (let i = 0; i < 45; i++) {
  const r = await call('GET', `/public/staff-cards/${'B'.repeat(21)}${i % 10}`);
  if (r.status === 429) limited++;
}
check('public verification is rate limited per client (429 after the allowance)', limited >= 5, `${limited} of 45 refused`);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exit(failed ? 1 : 0);
