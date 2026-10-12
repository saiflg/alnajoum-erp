#!/usr/bin/env node
/**
 * Live check of passport-number encryption at rest (Phase 24). LOCAL USE ONLY: it changes one demo customer's
 * passport number and restores it. Needs a running API and the demo seed.
 *
 *   node scripts/certification/passport-encryption-check.mjs
 *
 * Proves: no table holds a passport number in the clear; the API still returns readable numbers (profile, family
 * members, passengers nested in bookings); the lookup fingerprint is never returned; dashboard search finds a customer
 * by an EXACT passport number (any case / spacing), not by a fragment, and never across companies; a newly written
 * number is stored sealed and is searchable at once.
 */
import { execFileSync } from 'node:child_process';
const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const DB = process.env.DB_NAME || 'alnajoum_erp';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', DB, '-At', '-c', q], { encoding: 'utf8' }).trim();
const call = async (m, p, t, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let j; try { j = JSON.parse(x); } catch { /* */ } return { status: r.status, data: j?.data ?? j, text: x }; };
const results = []; const check = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n.padEnd(88)} ${String(d).slice(0, 70)}`); };

const customer = (await call('POST', '/auth/login', null, { email: 'chinedu.okafor@demo.alnajoum.travel', password: 'Demo@2026' })).data.accessToken;
const admin = (await call('POST', '/auth/login', null, { email: 'chidi.eze@demo.alnajoum.travel', password: 'Demo@2026' })).data.accessToken;
const other = (await call('POST', '/auth/login', null, { email: 'admin@zamzamhorizon.demo.alnajoum.travel', password: 'Demo@2026' })).data.accessToken;

// 1. the database holds ciphertext only
const plain = Number(sql(`select (select count(*) from customers where "passportNumber" is not null and "passportNumber" not like 'enc:v1:%') + (select count(*) from family_members where "passportNumber" is not null and "passportNumber" not like 'enc:v1:%') + (select count(*) from flight_booking_passengers where "passportNumber" is not null and "passportNumber" not like 'enc:v1:%') + (select count(*) from hajj_registration_pilgrims where "passportNumber" is not null and "passportNumber" not like 'enc:v1:%') + (select count(*) from umrah_registration_pilgrims where "passportNumber" is not null and "passportNumber" not like 'enc:v1:%') + (select count(*) from visa_applications where "applicantPassportNumber" is not null and "applicantPassportNumber" not like 'enc:v1:%')`));
check('no passport number is stored in the clear in any table', plain === 0, `${plain} plaintext`);

// 2. the app still reads them
const prof = await call('GET', '/customers/me', customer);
const pn = prof.data?.passportNumber;
check('the customer profile still returns a readable passport number', typeof pn === 'string' && !pn.startsWith('enc:v1:') && pn.length >= 5, pn);
check('the lookup fingerprint is never returned', !JSON.stringify(prof.data).includes('passportNumberIndex'));
const dbCipher = sql(`select "passportNumber" from customers c join identities i on i.id=c."identityId" where i.email='chinedu.okafor@demo.alnajoum.travel'`);
check('the same value in the database is ciphertext', dbCipher.startsWith('enc:v1:') && !dbCipher.includes(pn), dbCipher.slice(0, 30));

const familyOwner = (await call('POST', '/auth/login', null, { email: 'amina.yusuf@demo.alnajoum.travel', password: 'Demo@2026' })).data.accessToken;
const fam = await call('GET', '/customers/me/family-members', familyOwner);
const famPn = (fam.data ?? []).map((f) => f.passportNumber).filter(Boolean);
check('family members still show readable passport numbers', famPn.length > 0 && famPn.every((v) => !String(v).startsWith('enc:')), famPn.join(','));

const bookings = await call('GET', '/flights/bookings/me', customer);
const paxPn = (bookings.data ?? []).flatMap((b) => (b.passengers ?? []).map((p) => p.passportNumber)).filter(Boolean);
check('flight passengers (nested in bookings) still show readable passport numbers', paxPn.length > 0 && paxPn.every((v) => !String(v).startsWith('enc:')), paxPn.slice(0, 2).join(','));

// 3. search by an exact passport number
const found = await call('GET', `/dashboard/search?q=${encodeURIComponent(pn)}`, admin);
check('dashboard search finds the customer by exact passport number', (found.data?.customers ?? []).length >= 1, JSON.stringify(found.data?.customers?.[0]));
const spaced = await call('GET', `/dashboard/search?q=${encodeURIComponent(pn.toLowerCase().replace(/(.{3})/g, '$1 '))}`, admin);
check('...regardless of case and spacing', (spaced.data?.customers ?? []).length >= 1);
const partial = await call('GET', `/dashboard/search?q=${encodeURIComponent(pn.slice(0, 4))}`, admin);
check('a partial passport number finds nothing (equality only, by design)', (partial.data?.customers ?? []).length === 0, `${(partial.data?.customers ?? []).length} found`);
const cross = await call('GET', `/dashboard/search?q=${encodeURIComponent(pn)}`, other);
check("another company's admin cannot find that customer by passport", (cross.data?.customers ?? []).length === 0, `${(cross.data?.customers ?? []).length} found`);

// 4. writing: a new value is sealed, searchable, and read back
const set = `T${Date.now().toString().slice(-8)}`;
const upd = await call('PATCH', '/customers/me', customer, { passportNumber: set });
check('updating the profile with a new passport number succeeds', upd.status >= 200 && upd.status < 300, upd.status);
const back = await call('GET', '/customers/me', customer);
check('the new number reads back in plain form', back.data?.passportNumber === set, back.data?.passportNumber);
const stored = sql(`select "passportNumber" from customers c join identities i on i.id=c."identityId" where i.email='chinedu.okafor@demo.alnajoum.travel'`);
check('...and is stored as ciphertext', stored.startsWith('enc:v1:') && !stored.includes(set));
const refind = await call('GET', `/dashboard/search?q=${set}`, admin);
check('...and is immediately searchable (fingerprint maintained on write)', (refind.data?.customers ?? []).length >= 1);
await call('PATCH', '/customers/me', customer, { passportNumber: pn }); // restore

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`); process.exit(failed ? 1 : 0);
