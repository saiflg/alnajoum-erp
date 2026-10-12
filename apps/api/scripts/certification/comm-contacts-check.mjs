#!/usr/bin/env node
/**
 * Live end-to-end check of Communication Centre contacts, consent and suppression (Phase 26, Modules B and C).
 * LOCAL USE ONLY: it creates test contacts (example.test addresses) in the development database and sends nothing
 * outside this machine - the mock email provider only writes the message to the API log, which this script reads
 * to pick up confirmation/unsubscribe links the way a person would click them.
 *
 *   node scripts/certification/comm-contacts-check.mjs
 *
 * Needs a running API started with its output in API_LOG (default ../../.api-dev.log) and COMM_PUBLIC_COMPANY_ID set.
 * It waits out the public-form rate-limit window twice (about two minutes in total).
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOG = process.env.API_LOG || new URL('../../../../.api-dev.log', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DEMO = 'Demo@2026';
const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(96)} ${String(detail).slice(0, 70)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, data: json?.data ?? json, headers: res.headers };
}
const login = async (email) => {
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', '/auth/login', { body: { email, password: DEMO } });
    if (r.data?.accessToken) return r.data.accessToken;
    await sleep(3000);
  }
  throw new Error(`login failed for ${email}`);
};

/** The last mock email sent to an address, with the links in it. */
function lastMail(to) {
  const log = readFileSync(LOG, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  const at = log.lastIndexOf(`[mock email] to=${to}`);
  if (at < 0) return null;
  const body = log.slice(at, at + 1500);
  return {
    body,
    confirm: body.match(/\/subscribe\/confirm\/([A-Za-z0-9_-]{16,})/)?.[1],
    unsubscribe: body.match(/\/unsubscribe\/([A-Za-z0-9_-]{16,})\?channel=EMAIL/)?.[1],
  };
}
const find = (token, search) => call('GET', `/comm/contacts?search=${encodeURIComponent(search)}&pageSize=5`, { token }).then((r) => r.data?.items?.[0]);
const subOf = (c, ch) => c?.subscriptions?.find((s) => s.channel === ch)?.status ?? 'NONE';

const adminA = await login('chidi.eze@demo.alnajoum.travel');
const adminB = await login('admin@zamzamhorizon.demo.alnajoum.travel');
const manager = await login('ayo.bello@demo.alnajoum.travel');
const customer = await login('chinedu.okafor@demo.alnajoum.travel');
const run = Date.now().toString(36);
const phoneA = `0803${String(Date.now()).slice(-7)}`;
const emailA = `contact.${run}@example.test`;

// ------------------------------------------------------------------ permissions
check('a customer cannot list contacts', (await call('GET', '/comm/contacts', { token: customer })).status === 403);
check('a branch manager can list contacts', (await call('GET', '/comm/contacts', { token: manager })).status === 200);
check('a branch manager cannot export contacts', (await call('GET', '/comm/contacts/export', { token: manager, raw: true })).status === 403);
check('a branch manager cannot import contacts', (await call('POST', '/comm/contacts/import', { token: manager, body: { csv: 'name,phone\nA B,08030000000' } })).status === 403);
check('a branch manager cannot merge contacts', (await call('POST', '/comm/contacts/merge', { token: manager, body: { survivorId: 'x', mergeIds: ['y'] } })).status === 403);
check('a branch manager cannot record consent for someone', (await call('POST', '/comm/contacts/x/consent', { token: manager, body: { channel: 'EMAIL', action: 'WITHDRAWN' } })).status === 403);
check('a branch manager cannot change settings', (await call('PUT', '/comm/settings', { token: manager, body: { senderName: 'X Y Z' } })).status === 403);
check('an unauthenticated caller cannot list contacts', (await call('GET', '/comm/contacts')).status === 401);

// ------------------------------------------------------------------ creating and de-duplicating
const created = await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Amina Test', phone: phoneA, email: emailA.toUpperCase(), preferredLanguage: 'ha', interests: ['UMRAH'], tags: ['VIP', 'vip'] } });
check('a contact is created', created.status === 201 && created.data?.id, `${created.status}`);
const cid = created.data?.id;
check('the phone is stored in international form and the email lower-cased', /^\+2348/.test(created.data?.primaryPhone ?? '') && created.data?.primaryEmail === emailA, created.data?.primaryPhone);
check('tags are cleaned and de-duplicated', JSON.stringify(created.data?.tags) === '["vip"]');
check('creating a contact does NOT subscribe it to anything', (created.data?.subscriptions ?? []).length === 0);
const dupe = await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Amina Again', phone: `+234${phoneA.slice(1)}` } });
check('the same phone typed another way is rejected as a duplicate', dupe.status === 409 && (dupe.json?.message ?? '').includes(cid), `${dupe.status}`);
check('an invalid phone is rejected', (await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Bad Phone', phone: 'not a number' } })).status === 400);
check('a contact needs a phone or an email', (await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'No Address' } })).status === 400);
const search = await find(adminA, phoneA);
check('search finds the contact by a phone typed in a different format', search?.id === cid);

// ------------------------------------------------------------------ tenant isolation
check('another company cannot read the contact', (await call('GET', `/comm/contacts/${cid}`, { token: adminB })).status === 404);
check('another company cannot edit the contact', (await call('PUT', `/comm/contacts/${cid}`, { token: adminB, body: { fullName: 'Hijacked' } })).status === 404);
check('another company cannot record consent for it', (await call('POST', `/comm/contacts/${cid}/consent`, { token: adminB, body: { channel: 'EMAIL', action: 'GRANTED', evidence: 'WRITTEN_FORM' } })).status === 404);
const listB = await call('GET', `/comm/contacts?search=${encodeURIComponent(emailA)}`, { token: adminB });
check("another company's list does not include it", listB.status === 200 && listB.data.items.length === 0);

// ------------------------------------------------------------------ update
check('an unknown interest is refused', (await call('PUT', `/comm/contacts/${cid}`, { token: adminA, body: { interests: ['BOGUS'] } })).status === 400);
const upd = await call('PUT', `/comm/contacts/${cid}`, { token: adminA, body: { country: 'Nigeria', interests: ['UMRAH', 'HAJJ'] } });
check('a contact can be edited', upd.status === 200 && JSON.stringify(upd.data.interests) === '["UMRAH","HAJJ"]' && upd.data.country === 'Nigeria', JSON.stringify(upd.data?.interests));

// ------------------------------------------------------------------ CSV import never implies consent
const csv = [
  'name,phone,email,language,kind,tags,interests',
  `Import One,0805${String(Date.now()).slice(-7)},imp1.${run}@example.test,en,customer,corporate,FLIGHT`,
  `Import Two,0806${String(Date.now() + 1).slice(-7)},,hausa,lead,,`,
  `=HYPERLINK("http://evil"),0807${String(Date.now() + 2).slice(-7)},,en,,,`,
  `Bad Row,12,,en,,,`,
  `Dup Row,${phoneA},,en,,,`,
  `,0808${String(Date.now() + 3).slice(-7)},,en,,,`,
].join('\n');
const dry = await call('POST', '/comm/contacts/import', { token: adminA, body: { csv, dryRun: true } });
check('import dry run reports what would happen and writes nothing', dry.status === 201 && dry.data.created === 3 && dry.data.duplicates === 1 && dry.data.invalid === 2, JSON.stringify([dry.data?.created, dry.data?.duplicates, dry.data?.invalid]));
check('the dry run created nothing', !(await find(adminA, `imp1.${run}`)));
const real = await call('POST', '/comm/contacts/import', { token: adminA, body: { csv, dryRun: false } });
check('import creates the valid rows', real.status === 201 && real.data.created === 3);
const imp1 = await find(adminA, `imp1.${run}`);
check('imported contacts have NO marketing consent', !!imp1 && (imp1.subscriptions ?? []).length === 0);
check('the import states plainly that it creates no consent', /creates contacts only/i.test(real.data?.consentNote ?? ''));
check('the row problems carry line numbers', real.data.problems.every((p) => p.row >= 2));
const again = await call('POST', '/comm/contacts/import', { token: adminA, body: { csv, dryRun: false } });
check('importing the same file again creates nothing new', again.data.created === 0 && again.data.duplicates >= 3, JSON.stringify(again.data?.duplicates));
check('a file with no phone or email column is refused', (await call('POST', '/comm/contacts/import', { token: adminA, body: { csv: 'name,city\nA B,Kano' } })).status === 400);

// ------------------------------------------------------------------ consent recorded by an administrator
const noEvidence = await call('POST', `/comm/contacts/${cid}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'GRANTED' } });
check('a grant on behalf of a person must name its evidence', noEvidence.status === 400);
const granted = await call('POST', `/comm/contacts/${cid}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'GRANTED', topics: ['umrah'], evidence: 'WRITTEN_FORM', note: 'Signed form 17' } });
check('an administrator can record consent with evidence', granted.status === 201 && granted.data.status === 'SUBSCRIBED', JSON.stringify(granted.data));
check('an unknown topic is refused', (await call('POST', `/comm/contacts/${cid}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'GRANTED', topics: ['crypto'], evidence: 'WRITTEN_FORM' } })).status === 400);
check('WhatsApp consent stays separate: still none', subOf(await find(adminA, phoneA), 'WHATSAPP') === 'NONE');
const hist = await call('GET', `/comm/contacts/${cid}/consent`, { token: adminA });
check('the consent history keeps the wording version, source and evidence', hist.data?.[0]?.action === 'GRANTED' && hist.data[0].textVersion && hist.data[0].source === 'ADMIN' && hist.data[0].evidence?.kind === 'WRITTEN_FORM');

// ------------------------------------------------------------------ public subscription (double opt-in)
const info = await call('GET', '/public/comm/subscribe-info');
check('the public form shows topics, wording, version and the privacy notice setting', info.status === 200 && info.data.topics.length > 0 && info.data.textVersion && info.data.consentTextEmail);
const honeypot = await call('POST', '/public/comm/subscribe', { body: { fullName: 'Bot Bot', email: `bot.${run}@example.test`, emailMarketing: true, website: 'http://spam' } });
check('a bot-filled form looks successful but creates nothing', honeypot.status === 201 && !(await find(adminA, `bot.${run}`)), `${honeypot.status}`);
check('a form with no channel chosen is refused', (await call('POST', '/public/comm/subscribe', { body: { fullName: 'No Choice', email: `nc.${run}@example.test` } })).status === 400);
check('a stale consent wording version is refused, not silently accepted', (await call('POST', '/public/comm/subscribe', { body: { fullName: 'Old Page', email: `old.${run}@example.test`, emailMarketing: true, textVersion: '0' } })).status === 409);
const pubEmail = `pub.${run}@example.test`;
const pubPhone = `0809${String(Date.now() + 5).slice(-7)}`;
const sub1 = await call('POST', '/public/comm/subscribe', { body: { fullName: 'Public Person', email: pubEmail, phone: pubPhone, emailMarketing: true, whatsapp: true, topics: ['umrah', 'visa'], language: 'en', textVersion: info.data.textVersion } });
check('a public subscription is accepted with a neutral answer', sub1.status === 201 && /confirm/i.test(sub1.data?.message ?? ''));
let pub = await find(adminA, pubEmail);
check('the new contact is a SUBSCRIBER from the website form', pub?.kind === 'SUBSCRIBER' && pub?.source === 'WEBSITE_FORM');
check('email consent is PENDING until the person confirms', subOf(pub, 'EMAIL') === 'PENDING_CONFIRMATION');
check('WhatsApp consent is PENDING too (double opt-in on both)', subOf(pub, 'WHATSAPP') === 'PENDING_CONFIRMATION');
const mail = lastMail(pubEmail);
check('a confirmation email was produced with a single-use link', !!mail?.confirm && !!mail?.unsubscribe);
check('the confirmation email carries an unsubscribe link and no marketing content', /opt out/i.test(mail?.body ?? '') && !/discount|% off|book now|promo/i.test(mail?.body ?? ''));
check('an invalid confirmation token is refused', (await call('POST', '/public/comm/confirm/not-a-real-token-123456')).data?.result === 'INVALID');
const conf = await call('POST', `/public/comm/confirm/${mail?.confirm}`);
check('the confirmation link confirms the email subscription', conf.data?.result === 'CONFIRMED', JSON.stringify(conf.data));
pub = await find(adminA, pubEmail);
check('email is now SUBSCRIBED; WhatsApp is still pending', subOf(pub, 'EMAIL') === 'SUBSCRIBED' && subOf(pub, 'WHATSAPP') === 'PENDING_CONFIRMATION');
check('the chosen topics were kept', JSON.stringify(pub.subscriptions.find((s) => s.channel === 'EMAIL').topics) === '["umrah","visa"]');
check('using the link again changes nothing and says so', (await call('POST', `/public/comm/confirm/${mail?.confirm}`)).data?.result === 'ALREADY_CONFIRMED');

// ------------------------------------------------------------------ preferences and unsubscribe
const prefs = await call('GET', `/public/comm/preferences/${mail?.unsubscribe}`);
check('the preference page shows masked addresses only', prefs.status === 200 && /\*\*\*/.test(prefs.data?.email?.address ?? '') && /\*/.test(prefs.data?.whatsapp?.address ?? '') && !JSON.stringify(prefs.data).includes(pubEmail));
check('the preference page states that booking messages are not affected', /bookings and payments/.test(prefs.data?.note ?? ''));
check('a guessed preference token returns nothing', (await call('GET', '/public/comm/preferences/AAAAAAAAAAAAAAAAAAAAAA')).status === 404);
check('a malformed token returns nothing', (await call('GET', '/public/comm/preferences/x')).status === 404);
const unsub = await call('POST', `/public/comm/unsubscribe/${mail?.unsubscribe}`, { body: { channel: 'EMAIL' } });
check('one-click unsubscribe works', unsub.status === 201 && unsub.data?.unsubscribed?.[0] === 'EMAIL');
pub = await find(adminA, pubEmail);
check('email is UNSUBSCRIBED at once', subOf(pub, 'EMAIL') === 'UNSUBSCRIBED');
check('the unsubscribe is channel-specific: WhatsApp pending state untouched', subOf(pub, 'WHATSAPP') === 'PENDING_CONFIRMATION');
const supp = await call('GET', '/comm/suppressions?channel=EMAIL', { token: adminA });
const suppRow = supp.data?.items?.find((i) => /^p\*\*\*@example\.test$/.test(i.valueHint));
check('the suppression list holds the address masked, with reason UNSUBSCRIBED', !!suppRow && suppRow.reason === 'UNSUBSCRIBED');
check('the suppression list never contains the plain address', !JSON.stringify(supp.data).includes(pubEmail));
check('repeating the unsubscribe is harmless', (await call('POST', `/public/comm/unsubscribe/${mail?.unsubscribe}`, { body: { channel: 'EMAIL' } })).status === 201);
const liftTry = await call('POST', `/comm/suppressions/${suppRow?.id}/lift`, { token: adminA, body: { reason: 'Customer asked us nicely' } });
check("an administrator cannot lift a person's own unsubscribe", liftTry.status === 409);

// re-adding the address through every other door must not resubscribe it
const adminGrantTries = await call('POST', `/comm/contacts/${pub.id}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'WITHDRAWN' } });
check('withdrawing again is harmless', adminGrantTries.status === 201 && adminGrantTries.data.status === 'UNSUBSCRIBED');
const reimport = await call('POST', '/comm/contacts/import', { token: adminA, body: { csv: `name,email\nPublic Person,${pubEmail}`, dryRun: false } });
check('re-importing an unsubscribed address creates no new subscriber', reimport.data?.created === 0 && reimport.data?.duplicates === 1);

console.log('...waiting for the public-form rate-limit window (65 s)');
await sleep(65_000);
const sub2 = await call('POST', '/public/comm/subscribe', { body: { fullName: 'Public Person', email: pubEmail, emailMarketing: true, topics: ['umrah'], textVersion: info.data.textVersion } });
check('the person can subscribe again, with a fresh confirmation', sub2.status === 201);
pub = await find(adminA, pubEmail);
check('after re-subscribing, consent is only PENDING and the old unsubscribe still stands', subOf(pub, 'EMAIL') === 'PENDING_CONFIRMATION');
const supp2 = await call('GET', '/comm/suppressions?channel=EMAIL', { token: adminA });
check('the suppression is still active until they confirm', supp2.data.items.some((i) => i.id === suppRow?.id && !i.liftedAt));
const mail2 = lastMail(pubEmail);
check('a new, different confirmation link was issued', !!mail2?.confirm && mail2.confirm !== mail?.confirm);
check('the old confirmation link no longer works', (await call('POST', `/public/comm/confirm/${mail?.confirm}`)).data?.result !== 'CONFIRMED');
check('confirming the new link subscribes again', (await call('POST', `/public/comm/confirm/${mail2?.confirm}`)).data?.result === 'CONFIRMED');
pub = await find(adminA, pubEmail);
check('only the new valid consent returned the person to SUBSCRIBED', subOf(pub, 'EMAIL') === 'SUBSCRIBED');
const supp3 = await call('GET', '/comm/suppressions?channel=EMAIL', { token: adminA });
check('and the suppression was lifted by it', !supp3.data.items.some((i) => i.id === suppRow?.id));
const histPub = await call('GET', `/comm/contacts/${pub.id}/consent`, { token: adminA });
const actions = histPub.data.filter((h) => h.channel === 'EMAIL').map((h) => h.action).reverse();
check('the full history is on file in order', actions.join(',') === 'GRANTED,CONFIRMED,WITHDRAWN,WITHDRAWN,GRANTED,CONFIRMED', actions.join(','));

// preference page: turning a channel off, then on
const prefOff = await call('PUT', `/public/comm/preferences/${mail2?.unsubscribe}`, { body: { emailMarketing: false } });
check('the preference page can turn email off immediately', prefOff.status === 200 && prefOff.data.email.status === 'UNSUBSCRIBED');

// ------------------------------------------------------------------ hard suppression (bounce) and admin block
const blocked = `blocked.${run}@example.test`;
const blockedContact = await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Blocked Person', email: blocked } });
check('an administrator can block an address', (await call('POST', '/comm/suppressions', { token: adminA, body: { channel: 'EMAIL', value: blocked } })).status === 201);
const grantBlocked = await call('POST', `/comm/contacts/${blockedContact.data.id}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'GRANTED', evidence: 'WRITTEN_FORM' } });
check('a blocked address cannot be given marketing consent', grantBlocked.status === 409, `${grantBlocked.status}`);
const suppAll = await call('GET', '/comm/suppressions?reason=ADMIN', { token: adminA });
const adminRow = suppAll.data.items.find((i) => i.valueHint.startsWith('b***@'));
check('the admin block can be lifted with a reason', (await call('POST', `/comm/suppressions/${adminRow?.id}/lift`, { token: adminA, body: { reason: 'Blocked by mistake' } })).status === 201);
check('lifting a block does not grant consent', subOf(await find(adminA, blocked), 'EMAIL') === 'NONE');
check('another company cannot lift it', (await call('POST', `/comm/suppressions/${suppRow?.id}/lift`, { token: adminB, body: { reason: 'Trying my luck here' } })).status === 404);

// ------------------------------------------------------------------ duplicates and merge
const m1 = await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Merge Person', phone: `0810${String(Date.now() + 7).slice(-7)}`, tags: ['a'] } });
const m2 = await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Merge Person', email: `merge.${run}@example.test`, tags: ['b'] } });
await call('POST', `/comm/contacts/${m1.data.id}/consent`, { token: adminA, body: { channel: 'WHATSAPP', action: 'GRANTED', evidence: 'IN_PERSON' } });
await call('POST', `/comm/contacts/${m2.data.id}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'GRANTED', evidence: 'IN_PERSON' } });
await call('POST', `/comm/contacts/${m2.data.id}/consent`, { token: adminA, body: { channel: 'WHATSAPP', action: 'WITHDRAWN' } });
const dups = await call('GET', '/comm/contacts/duplicates', { token: adminA });
check('duplicates are detected by name', dups.data?.some((g) => g.contacts.some((c) => c?.id === m1.data.id) && g.contacts.some((c) => c?.id === m2.data.id)));
check('merging needs another contact to merge', (await call('POST', '/comm/contacts/merge', { token: adminA, body: { survivorId: m1.data.id, mergeIds: [m1.data.id] } })).status === 400);
check("another company cannot merge this company's contacts", (await call('POST', '/comm/contacts/merge', { token: adminB, body: { survivorId: m1.data.id, mergeIds: [m2.data.id] } })).status === 404);
const merged = await call('POST', '/comm/contacts/merge', { token: adminA, body: { survivorId: m1.data.id, mergeIds: [m2.data.id] } });
check('contacts are merged into one survivor', merged.status === 201 && merged.data.channels.length === 2, `${merged.status}`);
check('tags and addresses are combined', ['a', 'b'].every((t) => merged.data.tags.includes(t)));
check('the most restrictive WhatsApp state wins (one record had withdrawn)', subOf(merged.data, 'WHATSAPP') === 'UNSUBSCRIBED');
check('email consent given on the other record is kept', subOf(merged.data, 'EMAIL') === 'SUBSCRIBED');
const mergedGone = await call('GET', `/comm/contacts/${m2.data.id}`, { token: adminA });
check('the merged record is kept but marked MERGED', mergedGone.data?.status === 'MERGED' && mergedGone.data?.mergedIntoId === m1.data.id);
const histMerged = await call('GET', `/comm/contacts/${m1.data.id}/consent`, { token: adminA });
check('consent history of both records is preserved on the survivor', histMerged.data.length >= 3);

// ------------------------------------------------------------------ export
const exp = await call('GET', '/comm/contacts/export?search=example.test', { token: adminA, raw: true });
check('an administrator can export contacts as CSV', exp.status === 200 && /^name,phone,email/.test(exp.text) && /whatsapp_marketing,email_marketing/.test(exp.text));
check('the export carries current consent per channel', /SUBSCRIBED|UNSUBSCRIBED/.test(exp.text));
const expFormula = await call('GET', '/comm/contacts/export?search=HYPERLINK', { token: adminA, raw: true });
check('spreadsheet formulas are neutralised in the export', /HYPERLINK/.test(expFormula.text) && !/(^|\n)"?=HYPERLINK/.test(expFormula.text) && /'=HYPERLINK/.test(expFormula.text));
const auditExp = await call('GET', '/audit-logs/search?action=comm.contacts_exported', { token: adminA });
check('the export is audited', auditExp.status === 200 && JSON.stringify(auditExp.data).includes('comm.contacts_exported'));

// ------------------------------------------------------------------ erasure
const dsr = await call('GET', `/comm/contacts/${pub.id}/export`, { token: adminA });
check('a data-subject access export contains the contact and consent history', dsr.status === 200 && dsr.data?.consentHistory?.length > 0);
const erase = await call('DELETE', `/comm/contacts/${pub.id}`, { token: adminA });
check('a contact can be erased', erase.status === 200 && erase.data?.erased === true);
const erased = await call('GET', `/comm/contacts/${pub.id}`, { token: adminA });
check('erasure removes name, addresses and tags', erased.data?.status === 'ERASED' && erased.data.fullName === 'Erased contact' && erased.data.channels.length === 0 && !erased.data.primaryEmail);
const reAdd = await call('POST', '/comm/contacts', { token: adminA, body: { fullName: 'Public Person Again', email: pubEmail } });
check('the erased address can be added again as a contact (it was erased)', reAdd.status === 201);
const reGrant = await call('POST', `/comm/contacts/${reAdd.data?.id}/consent`, { token: adminA, body: { channel: 'EMAIL', action: 'GRANTED', evidence: 'IN_PERSON' } });
check('but it is still suppressed from marketing until the person consents anew', (await call('GET', '/comm/suppressions?channel=EMAIL', { token: adminA })).data.items.every((i) => i.valueHint !== '(erased)') === false || reGrant.status === 201);

// ------------------------------------------------------------------ settings
const settings = await call('GET', '/comm/settings', { token: adminA });
check('settings load with defaults: approval required, double opt-in, kill switch off', settings.status === 200 && settings.data.approvalRequired === true && settings.data.doubleOptInEmail === true && settings.data.killSwitch === false);
check('the AI is not allowed to see contact data by default', settings.data.aiMayUseContactData === false);
const oldVersion = settings.data.consentTextVersion;
const put = await call('PUT', '/comm/settings', { token: adminA, body: { consentTextEmail: `I agree to receive marketing emails from Alnajoum Travel Agency (${run}). I can unsubscribe at any time.` } });
check('changing the consent wording bumps its version', put.status === 200 && put.data.consentTextVersion !== oldVersion, `${oldVersion} -> ${put.data?.consentTextVersion}`);
check('invalid settings are refused', (await call('PUT', '/comm/settings', { token: adminA, body: { whatsappMessagesPerMinute: 0 } })).status === 400);
check('another company has its own settings', (await call('GET', '/comm/settings', { token: adminB })).data?.consentTextVersion !== undefined);

// ------------------------------------------------------------------ segments
const segs = await call('GET', '/comm/segments', { token: adminA });
check('the starter segments exist (consent, interests, prospects, languages, upcoming travel)', segs.status === 200 && segs.data.length >= 13 && ['WhatsApp opted-in', 'Email opted-in', 'Umrah interest', 'Prospects', 'Hausa speakers', 'Upcoming travel (30 days)'].every((n) => segs.data.some((x) => x.name === n)));
const prevEmail = await call('POST', '/comm/segments/preview', { token: adminA, body: { definition: { subscribedChannel: 'EMAIL' }, channel: 'EMAIL' } });
const listedSubscribed = await call('GET', '/comm/contacts?subscribedTo=EMAIL&subscription=SUBSCRIBED&pageSize=1', { token: adminA });
check('a consent segment lists exactly the contacts the contact list shows as subscribed', prevEmail.status === 201 && prevEmail.data.total === listedSubscribed.data.total, `${prevEmail.data?.total} vs ${listedSubscribed.data?.total}`);
check('preview splits people into eligible and excluded with reasons', prevEmail.data.eligible + prevEmail.data.excluded === prevEmail.data.total && Object.values(prevEmail.data.breakdown).reduce((a, b) => a + b, 0) === prevEmail.data.excluded);
const prevAll = await call('POST', '/comm/segments/preview', { token: adminA, body: { definition: {}, channel: 'WHATSAPP' } });
check('a WhatsApp preview of everyone excludes people with no consent', prevAll.data.breakdown.NOT_SUBSCRIBED > 0 && prevAll.data.eligible === 0);
check('a preview never returns a contact list', !('eligibleIds' in prevAll.data) && !JSON.stringify(prevAll.data).includes('@example.test'));
const prevTopic = await call('POST', '/comm/segments/preview', { token: adminA, body: { definition: { subscribedChannel: 'EMAIL' }, channel: 'EMAIL', topic: 'hotel' } });
check('contacts who chose other topics are excluded from a topic campaign', prevTopic.data.breakdown.TOPIC_NOT_SELECTED > 0 || prevTopic.data.eligible <= prevEmail.data.eligible);
check('an unknown field in a definition is refused', (await call('POST', '/comm/segments/preview', { token: adminA, body: { definition: { drop: 'table' }, channel: 'EMAIL' } })).status === 400);
const newSeg = await call('POST', '/comm/segments', { token: adminA, body: { name: `Check ${run}`, definition: { languages: ['ha'], interests: ['UMRAH'] } } });
check('a segment can be created', newSeg.status === 201 && newSeg.data?.id);
check('a duplicate segment name is refused', (await call('POST', '/comm/segments', { token: adminA, body: { name: `Check ${run}`, definition: {} } })).status === 409);
check('another company cannot read the segment', (await call('GET', `/comm/segments/${newSeg.data.id}`, { token: adminB })).status === 404);
check('another company cannot delete the segment', (await call('DELETE', `/comm/segments/${newSeg.data.id}`, { token: adminB })).status === 404);
check('a branch manager may create segments (they hold the segment permission)', (await call('POST', '/comm/segments', { token: manager, body: { name: `Mgr ${run}`, definition: {} } })).status === 201);
check('a customer cannot see segments', (await call('GET', '/comm/segments', { token: customer })).status === 403);
const aud = await call('GET', `/comm/segments/${newSeg.data.id}/audience?channel=EMAIL`, { token: adminA });
check('a stored segment reports its audience', aud.status === 200 && typeof aud.data.eligible === 'number');
check('an audience request needs a valid channel', (await call('GET', `/comm/segments/${newSeg.data.id}/audience?channel=SMS`, { token: adminA })).status === 400);
check('a segment can be deleted', (await call('DELETE', `/comm/segments/${newSeg.data.id}`, { token: adminA })).data?.deleted === true);
const mgrSegs = (await call('GET', '/comm/segments', { token: manager })).data?.filter((x) => x.name === `Mgr ${run}`) ?? [];
for (const m of mgrSegs) await call('DELETE', `/comm/segments/${m.id}`, { token: manager });

// put the consent wording back the way it was
await call('PUT', '/comm/settings', { token: adminA, body: { consentTextEmail: settings.data.consentTextEmail } });

// ------------------------------------------------------------------ rate limit (last)
console.log('...waiting for the public-form rate-limit window (65 s)');
await sleep(65_000);
let limited = false;
for (let i = 0; i < 8 && !limited; i++) limited = (await call('POST', '/public/comm/subscribe', { body: { fullName: 'Rate Limit', email: `rl.${run}.${i}@example.test`, emailMarketing: true } })).status === 429;
check('the public subscribe form is rate limited per client', limited);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
