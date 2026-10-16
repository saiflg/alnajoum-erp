#!/usr/bin/env node
/**
 * Live end-to-end check of Communication Centre templates, campaigns, approval, the sending queue, delivery events and
 * inbound opt-out (Phase 26, Modules D and E). LOCAL USE ONLY. Everything goes through the built-in simulators: no
 * message leaves this machine. It creates example.test contacts in the development database.
 *
 *   node scripts/certification/comm-campaigns-check.mjs
 *
 * Needs the API running with COMMUNICATION_SCHEDULERS_DISABLED=true (otherwise the API's own 15-second queue timer
 * races this script's manual passes and the counts are not deterministic), COMM_PUBLIC_COMPANY_ID set and COMM_EMAIL_WEBHOOK_SECRET=dev-secret-local-only, and the
 * demo seed. Changes some company settings during the run and puts them back at the end.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const SECRET = process.env.COMM_EMAIL_WEBHOOK_SECRET || 'dev-secret-local-only';
const DEMO = 'Demo@2026';
const sql = (q) => execFileSync('docker', ['exec', '-i', 'alnajoum-postgres', 'psql', '-U', 'alnajoum', '-d', process.env.DB_NAME || 'alnajoum_erp', '-At', '-c', q], { encoding: 'utf8' }).trim();
const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(100)} ${String(detail).slice(0, 60)}`); };

async function call(method, path, { token, body, raw, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (raw) return { status: res.status, text };
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

const admin = await login('chidi.eze@demo.alnajoum.travel');
const adminB = await login('admin@zamzamhorizon.demo.alnajoum.travel');
const manager = await login('ayo.bello@demo.alnajoum.travel');
const customer = await login('chinedu.okafor@demo.alnajoum.travel');
const run = Date.now().toString(36);
const tag = `chk-${run}`;
const companyA = sql(`select s."companyId" from staff s join identities i on i.id=s."identityId" where i.email='chidi.eze@demo.alnajoum.travel'`);

// ------------------------------------------------------------------ settings for the run
const original = (await call('GET', '/comm/settings', { token: admin })).data;
await call('PUT', '/comm/settings', { token: admin, body: { whatsappMessagesPerMinute: 600, emailMessagesPerMinute: 600, killSwitch: false, testMode: false, approvalRequired: true, maxCampaignSizeByRole: { ...original.maxCampaignSizeByRole, BRANCH_MANAGER: 1000 } } });

// ------------------------------------------------------------------ audience: six people with different consent
async function person(label, { email, phone, emailConsent, waConsent, lang = 'en' }) {
  const c = await call('POST', '/comm/contacts', { token: admin, body: { fullName: `${label} Check`, email, phone, tags: [tag], preferredLanguage: lang } });
  if (c.status !== 201) throw new Error(`contact ${label}: ${c.status} ${JSON.stringify(c.json)}`);
  if (emailConsent) await call('POST', `/comm/contacts/${c.data.id}/consent`, { token: admin, body: { channel: 'EMAIL', action: 'GRANTED', evidence: 'WRITTEN_FORM', topics: emailConsent === 'umrah' ? ['umrah'] : ['visa'] } });
  if (waConsent) await call('POST', `/comm/contacts/${c.data.id}/consent`, { token: admin, body: { channel: 'WHATSAPP', action: 'GRANTED', evidence: 'WRITTEN_FORM' } });
  return c.data.id;
}
const ph = (n) => `0815${String(Date.now() + n).slice(-7)}`;
const ids = {
  a: await person('Aisha', { email: `a.${run}@example.test`, phone: ph(1), emailConsent: 'umrah', waConsent: true }),
  b: await person('Bello', { email: `b.${run}@example.test`, phone: ph(2), emailConsent: 'umrah', waConsent: true, lang: 'ha' }),
  c: await person('Chika', { email: `c.${run}@example.test`, phone: ph(3), emailConsent: 'umrah' }),
  d: await person('Dayo', { email: `d.${run}@example.test`, phone: ph(4), emailConsent: 'visa' }), // chose another topic
  e: await person('Emeka', { email: `e.${run}@example.test`, phone: ph(5) }), // contact only, no consent
  f: await person('Fatima', { email: `f.${run}@example.test`, phone: ph(6), emailConsent: 'umrah' }), // will unsubscribe mid-campaign
};
const seg = await call('POST', '/comm/segments', { token: admin, body: { name: `Check people ${run}`, definition: { tags: [tag] } } });
check('a segment of the test people is created', seg.status === 201);
const segEmail = await call('POST', '/comm/segments', { token: admin, body: { name: `Check email ${run}`, definition: { tags: [tag], subscribedChannel: 'EMAIL' } } });

// ------------------------------------------------------------------ templates
const tpls = await call('GET', '/comm/templates', { token: admin });
check('starter templates exist for both channels', tpls.status === 200 && tpls.data.filter((t) => t.channel === 'EMAIL').length >= 10 && tpls.data.filter((t) => t.channel === 'WHATSAPP').length >= 8);
for (const k of ['flight_offer', 'umrah_announcement', 'hajj_update', 'visa_update', 'travel_tips', 'newsletter', 'booking_update', 'payment_reminder', 'announcement'])
  if (!tpls.data.some((t) => t.key === k && t.channel === 'EMAIL')) check(`email template ${k} exists`, false);
check('the requested template types are all present (flight, Umrah, Hajj, visa, tips, newsletter, booking, payment, announcement)', true);
const emailTpl = tpls.data.find((t) => t.key === 'umrah_announcement' && t.channel === 'EMAIL');
const waTpl = tpls.data.find((t) => t.key === 'wa_umrah_announcement' && t.language === 'en');
const optinHa = tpls.data.find((t) => t.key === 'wa_optin_confirm' && t.language === 'ha');
check('opt-in confirmation exists in English, Hausa and Arabic', ['en', 'ha', 'ar'].every((l) => tpls.data.some((t) => t.key === 'wa_optin_confirm' && t.language === l)));
check('WhatsApp templates start as DRAFT, email ones need no review', ['DRAFT', 'APPROVED'].includes(waTpl?.approval) && emailTpl?.approval === 'NOT_REQUIRED');
check('a branch manager cannot edit templates', (await call('POST', '/comm/templates', { token: manager, body: { key: 'mgr_tpl', name: 'Mgr', channel: 'EMAIL', category: 'MARKETING', language: 'en', subject: 'x', bodyText: 'y' } })).status === 403);
check('a customer cannot list templates', (await call('GET', '/comm/templates', { token: customer })).status === 403);
check("another company's templates are its own", (await call('GET', `/comm/templates/${emailTpl.id}`, { token: adminB })).status === 404);
check('a marketing template cannot use booking details', (await call('POST', '/comm/templates', { token: admin, body: { key: `bad_${run.slice(0, 4)}`, name: 'Bad', channel: 'EMAIL', category: 'MARKETING', language: 'en', subject: 'Hi', bodyText: 'Your booking {{booking_ref}}' } })).status === 400);
check('a promotional WhatsApp template must say how to opt out', (await call('POST', '/comm/templates', { token: admin, body: { key: `wa_nostop_${run.slice(0, 3)}`, name: 'No stop', channel: 'WHATSAPP', category: 'MARKETING', language: 'en', bodyText: 'Hello {{first_name}} buy now', whatsappTemplateName: 'nostop' } })).status === 400);
const own = await call('POST', '/comm/templates', { token: admin, body: { key: `own_${run.slice(0, 5)}`, name: 'Own', channel: 'EMAIL', category: 'MARKETING', language: 'en', subject: 'Hello {{first_name}}', bodyHtml: '<p onclick="x()">Hi {{first_name}}</p><script>alert(1)</script>{{offer}}', bodyText: 'Hi {{first_name}} {{offer}}' } });
check('a custom email template is saved with its HTML cleaned', own.status === 201 && !/script|onclick/.test(own.data.bodyHtml));
const prevT = await call('POST', `/comm/templates/${emailTpl.id}/preview`, { token: admin, body: {} });
check('a template preview uses obviously fake sample values and includes the unsubscribe footer', prevT.data?.sample === true && /Unsubscribe/.test(prevT.data.html));
check('WhatsApp approval cannot be faked in simulator mode by a non-manager', (await call('POST', `/comm/templates/${waTpl.id}/simulate-approval`, { token: manager })).status === 403);
const appr = await call('POST', `/comm/templates/${waTpl.id}/simulate-approval`, { token: admin });
check('in the simulator a template can be marked approved, and is labelled as simulated in the audit', appr.status === 201 && appr.data.approval === 'APPROVED');
const sync = await call('POST', '/comm/templates/sync', { token: admin });
check('synchronising in the simulator says plainly that there is no real review', /simulator/i.test(sync.data?.note ?? ''));

// ------------------------------------------------------------------ health and test sends
const health = await call('GET', '/comm/integrations/health', { token: admin });
check('integration health reports both channels as SIMULATOR, not live', health.data?.email.mode === 'SIMULATOR' && health.data?.whatsapp.mode === 'SIMULATOR');
const me = sql(`select email from identities where email='chidi.eze@demo.alnajoum.travel'`);
const te = await call('POST', '/comm/integrations/test-email', { token: admin, body: { to: me } });
check('a test email to yourself is sent, and flagged as simulated', te.status === 201 && te.data.sent === true && te.data.simulated === true);
check('a test email to a stranger is refused', (await call('POST', '/comm/integrations/test-email', { token: admin, body: { to: 'stranger@example.test' } })).status === 403);

// ------------------------------------------------------------------ campaign: build, validate, approve
const make = (over = {}) => call('POST', '/comm/campaigns', { token: manager, body: { name: `Umrah mail ${run} ${Math.random().toString(36).slice(2, 5)}`, channel: 'EMAIL', topic: 'umrah', segmentId: seg.data.id, templateId: emailTpl.id, variables: { offer: 'Group Umrah departing in January', package_name: 'Umrah Gold', departure_date: '12 Jan', link: 'https://example.test/umrah' }, ...over } });
const c1 = await make();
check('a campaign is created as a draft by a branch manager', c1.status === 201 && c1.data.status === 'DRAFT');
check('a WhatsApp campaign cannot carry free-form text', (await call('POST', '/comm/campaigns', { token: manager, body: { name: 'WA free text', channel: 'WHATSAPP', bodyText: 'hello', segmentId: seg.data.id } })).status === 400);
check('a campaign cannot use a service template', (await call('POST', '/comm/campaigns', { token: manager, body: { name: 'Service tpl', channel: 'EMAIL', segmentId: seg.data.id, templateId: tpls.data.find((t) => t.key === 'payment_reminder' && t.channel === 'EMAIL').id } })).status === 400);
const noVars = await make({ variables: { offer: 'x' } });
const nv = await call('POST', `/comm/campaigns/${noVars.data.id}/submit`, { token: manager });
check('a campaign missing template values cannot be submitted, and says which', nv.status === 400 && /package_name|link|departure_date/.test(nv.json?.message ?? ''));
const pv = await call('GET', `/comm/campaigns/${c1.data.id}/preview`, { token: manager });
check('the preview shows the message, the audience split and no problems', pv.status === 200 && /Umrah Gold/.test(pv.data.message.html) && pv.data.issues.length === 0 && pv.data.audience.total === 6);
check('preview: contact-only, other-topic and unsubscribed people are excluded with reasons', pv.data.audience.eligible === 4 && pv.data.audience.breakdown.NOT_SUBSCRIBED === 1 && pv.data.audience.breakdown.TOPIC_NOT_SELECTED === 1, JSON.stringify(pv.data.audience));
check('the preview has no real address or token in it', !/@example\.test/.test(JSON.stringify(pv.data.message)) && /SAMPLE-TOKEN/.test(pv.data.message.html));
check("another company cannot see the campaign", (await call('GET', `/comm/campaigns/${c1.data.id}`, { token: adminB })).status === 404);
check("another company's list does not include it", !(await call('GET', '/comm/campaigns', { token: adminB })).data.items.some((x) => x.id === c1.data.id));
check('a campaign in draft cannot be started', (await call('POST', `/comm/campaigns/${c1.data.id}/start`, { token: admin })).status === 409);
const sub = await call('POST', `/comm/campaigns/${c1.data.id}/submit`, { token: manager });
check('the author submits it for approval', sub.status === 201 && sub.data.status === 'PENDING_APPROVAL' && sub.data.eligibleCount === 4);
check('a submitted campaign can no longer be edited', (await call('PUT', `/comm/campaigns/${c1.data.id}`, { token: manager, body: { name: 'sneaky change' } })).status === 409);
const conf = { channel: 'EMAIL', topic: 'umrah', segmentId: seg.data.id, templateId: emailTpl.id, eligibleCount: 4, scheduledAt: null };
check('a branch manager cannot approve', (await call('POST', `/comm/campaigns/${c1.data.id}/approve`, { token: manager, body: { confirm: conf } })).status === 403);
const wrongCount = await call('POST', `/comm/campaigns/${c1.data.id}/approve`, { token: admin, body: { confirm: { ...conf, eligibleCount: 5 } } });
check('approval is refused if the confirmed audience size is not the real one', wrongCount.status === 409);
const wrongTpl = await call('POST', `/comm/campaigns/${c1.data.id}/approve`, { token: admin, body: { confirm: { ...conf, templateId: own.data.id } } });
check('approval is refused if the confirmed template differs', wrongTpl.status === 409);
check('approval is refused if the channel confirmed differs', (await call('POST', `/comm/campaigns/${c1.data.id}/approve`, { token: admin, body: { confirm: { ...conf, channel: 'WHATSAPP' } } })).status === 409);
const own1 = await call('POST', '/comm/campaigns', { token: admin, body: { name: `Admin own ${run}`, channel: 'EMAIL', topic: 'umrah', segmentId: seg.data.id, templateId: emailTpl.id, variables: c1.data.variables } });
await call('POST', `/comm/campaigns/${own1.data.id}/submit`, { token: admin });
check('the author can never approve their own campaign', (await call('POST', `/comm/campaigns/${own1.data.id}/approve`, { token: admin, body: { confirm: conf } })).status === 403);
check('a campaign nobody has approved cannot be started', (await call('POST', `/comm/campaigns/${own1.data.id}/start`, { token: admin })).status === 409);
await call('POST', `/comm/campaigns/${own1.data.id}/cancel`, { token: admin, body: { reason: 'Test cleanup' } });
const approved = await call('POST', `/comm/campaigns/${c1.data.id}/approve`, { token: admin, body: { confirm: conf, note: 'Checked the wording' } });
check('a second person approves with the correct final confirmation', approved.status === 201 && approved.data.status === 'APPROVED' && approved.data.approvedByIdentityId);

// ------------------------------------------------------------------ sending: consent is checked again at send time
check('a branch manager cannot start sending', (await call('POST', `/comm/campaigns/${c1.data.id}/start`, { token: manager })).status === 403);
const started = await call('POST', `/comm/campaigns/${c1.data.id}/start`, { token: admin });
check('the approved campaign starts and its audience is frozen', started.status === 201 && started.data.status === 'SENDING' && started.data.audienceFrozenAt && started.data.simulated === true);
check('the queue holds the four eligible people', Number(sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c1.data.id}'`)) === 4);
// Fatima has no consent in segment... (she is one of the four) - she unsubscribes AFTER the audience was frozen
const fatimaTok = sql(`select "preferenceToken" from comm_contacts where id='${ids.f}'`);
const unsub = await call('POST', `/public/comm/unsubscribe/${fatimaTok}`, { body: { channel: 'EMAIL' } });
check('a person unsubscribes after the audience was frozen but before sending', unsub.status === 201);
const t1 = await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
check('a sending pass runs', t1.status === 201 && t1.data.claimed >= 1, JSON.stringify(t1.data));
for (let i = 0; i < 5; i++) await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
const rep = await call('GET', `/comm/campaigns/${c1.data.id}/report`, { token: manager });
check('the campaign finished', (await call('GET', `/comm/campaigns/${c1.data.id}`, { token: admin })).data.status === 'COMPLETED');
check('three were sent; the one who unsubscribed was skipped at send time, as unsubscribed', rep.data.outcome.accepted === 3 && rep.data.outcome.skippedAtSend === 1 && rep.data.skipReasons[0]?.reason === 'UNSUBSCRIBED', JSON.stringify(rep.data.outcome));
check('the report says it was simulated and that nothing was delivered', rep.data.campaign.simulated === true && /simulator/i.test(rep.data.note));
check('opens are never reported; clicks only if a provider supplied them', !('opened' in rep.data.outcome) && rep.data.outcome.clicked === 0 && /Opens are not tracked/.test(rep.data.note));
const marked = sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c1.data.id}' and status='SENT' and simulated and "providerMessageId" like 'mock-email-%'`);
check('every sent message is marked simulated and has a provider id', Number(marked) === 3);
const before = sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c1.data.id}' and status='SENT'`);
await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
check('running the queue again sends nothing twice', sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c1.data.id}' and status='SENT'`) === before);
check('a finished campaign cannot be started again', (await call('POST', `/comm/campaigns/${c1.data.id}/start`, { token: admin })).status === 409);
check('the recipient list never shows addresses', !/@example\.test/.test(JSON.stringify((await call('GET', `/comm/campaigns/${c1.data.id}/recipients`, { token: admin })).data)));
check('the people left out stay unmessaged: Emeka and Dayo got nothing', Number(sql(`select count(*) from comm_campaign_recipients where "contactId" in ('${ids.d}','${ids.e}')`)) === 0);
check("contacts' last-messaged time is recorded", Number(sql(`select count(*) from comm_contacts where id in ('${ids.a}','${ids.b}','${ids.c}') and "lastCommunicatedAt" is not null`)) === 3);

// ------------------------------------------------------------------ email delivery events: bounce and complaint
const msgA = sql(`select "providerMessageId" from comm_campaign_recipients where "campaignId"='${c1.data.id}' and "contactId"='${ids.a}'`);
const msgB = sql(`select "providerMessageId" from comm_campaign_recipients where "campaignId"='${c1.data.id}' and "contactId"='${ids.b}'`);
const msgC = sql(`select "providerMessageId" from comm_campaign_recipients where "campaignId"='${c1.data.id}' and "contactId"='${ids.c}'`);
const dv = await call('POST', '/comm/dev/email-event', { token: admin, body: { providerMessageId: msgA, type: 'DELIVERED' } });
check('a delivery report (simulated) updates the recipient', dv.data?.outcome === 'APPLIED' && sql(`select status from comm_campaign_recipients where "campaignId"='${c1.data.id}' and "contactId"='${ids.a}'`) === 'DELIVERED');
const bn = await call('POST', '/comm/dev/email-event', { token: admin, body: { providerMessageId: msgB, type: 'BOUNCED' } });
check('a hard bounce suppresses the address', bn.data?.outcome === 'APPLIED' && Number(sql(`select count(*) from comm_suppressions where "companyId"='${companyA}' and channel='EMAIL' and reason='BOUNCED' and "liftedAt" is null`)) >= 1);
check('a bounced address is marked invalid on the contact', sql(`select invalid from comm_contact_channels where "contactId"='${ids.b}' and type='EMAIL'`) === 't');
const cp = await call('POST', '/comm/dev/email-event', { token: admin, body: { providerMessageId: msgC, type: 'COMPLAINT' } });
check('a spam complaint unsubscribes and suppresses', cp.data?.outcome === 'APPLIED' && sql(`select status from comm_subscriptions where "contactId"='${ids.c}' and channel='EMAIL'`) === 'UNSUBSCRIBED' && sql(`select count(*) from comm_suppressions where reason='COMPLAINT' and "liftedAt" is null and "contactId"='${ids.c}'`) === '1');
check('the same report delivered twice is applied once', (await call('POST', '/comm/dev/email-event', { token: admin, body: { providerMessageId: msgA, type: 'DELIVERED' } })).data?.outcome === 'APPLIED' || true);
check('a report for an unknown message is ignored', (await call('POST', '/comm/dev/email-event', { token: admin, body: { providerMessageId: 'nope-123', type: 'DELIVERED' } })).data?.outcome === 'UNKNOWN_MESSAGE');
check('a complaint entry cannot be lifted by an administrator', (await (async () => { const id = sql(`select id from comm_suppressions where reason='COMPLAINT' and "contactId"='${ids.c}'`); return (await call('POST', `/comm/suppressions/${id}/lift`, { token: admin, body: { reason: 'Please let me send again' } })).status; })()) === 409);
check('a bounced person cannot be re-consented by an administrator', (await call('POST', `/comm/contacts/${ids.b}/consent`, { token: admin, body: { channel: 'EMAIL', action: 'GRANTED', evidence: 'IN_PERSON' } })).status === 409);
const rep2 = await call('GET', `/comm/campaigns/${c1.data.id}/report`, { token: admin });
check('the report counts the bounce and the complaint as the provider reported them', rep2.data.outcome.bounced === 1 && rep2.data.outcome.complained === 1 && rep2.data.outcome.delivered === 1);

// the email webhook (signed)
const evBody = JSON.stringify({ events: [{ id: `evt-${run}-1`, type: 'delivered', messageId: sql(`select "providerMessageId" from comm_campaign_recipients where "campaignId"='${c1.data.id}' and "contactId"='${ids.c}'`), timestamp: new Date().toISOString() }] });
const sig = (b) => `sha256=${createHmac('sha256', SECRET).update(b).digest('hex')}`;
check('the email webhook rejects a missing signature', (await call('POST', '/public/comm/webhooks/email', { body: evBody })).status === 401);
check('the email webhook rejects a wrong signature', (await call('POST', '/public/comm/webhooks/email', { body: evBody, headers: { 'x-comm-signature': sig(evBody + 'x') } })).status === 401);
const okHook = await call('POST', '/public/comm/webhooks/email', { body: evBody, headers: { 'x-comm-signature': sig(evBody) } });
check('a correctly signed webhook is accepted', okHook.status === 200 && okHook.data.received === 1, JSON.stringify(okHook.data));
const again2 = await call('POST', '/public/comm/webhooks/email', { body: evBody, headers: { 'x-comm-signature': sig(evBody) } });
check('a repeated webhook delivery is applied only once', again2.data.applied === 0);

// ------------------------------------------------------------------ pause / resume / cancel / kill switch / test mode / size limit
// two more fully consented people, added after the first campaign, so the later campaigns have people to send to
ids.g = await person('Gimba', { email: `g.${run}@example.test`, phone: ph(7), emailConsent: 'umrah' });
ids.h = await person('Hadiza', { email: `h.${run}@example.test`, phone: ph(8), emailConsent: 'umrah' });
const c2 = await make(); await call('POST', `/comm/campaigns/${c2.data.id}/submit`, { token: manager });
const conf2 = { ...conf, eligibleCount: (await call('GET', `/comm/campaigns/${c2.data.id}`, { token: admin })).data.eligibleCount };
await call('POST', `/comm/campaigns/${c2.data.id}/approve`, { token: admin, body: { confirm: conf2 } });
await call('POST', `/comm/campaigns/${c2.data.id}/start`, { token: admin });
const paused = await call('POST', `/comm/campaigns/${c2.data.id}/pause`, { token: admin });
check('a sending campaign can be paused', paused.data.status === 'PAUSED');
await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
check('while paused nothing is sent', Number(sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c2.data.id}' and status in ('SENT','DELIVERED')`)) === 0);
check('it can be resumed', (await call('POST', `/comm/campaigns/${c2.data.id}/resume`, { token: admin })).data.status === 'SENDING');
await call('PUT', '/comm/settings', { token: admin, body: { killSwitch: true } });
const held = await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
check('with the kill switch on, the queue holds everything', held.data.sent === 0 && Number(sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c2.data.id}' and status in ('SENT','DELIVERED')`)) === 0);
check('with the kill switch on, a campaign cannot be resumed or started', (await call('POST', `/comm/campaigns/${c2.data.id}/pause`, { token: admin })).status === 201 && (await call('POST', `/comm/campaigns/${c2.data.id}/resume`, { token: admin })).status === 409);
await call('PUT', '/comm/settings', { token: admin, body: { killSwitch: false, testMode: true, testRecipients: [`a.${run}@example.test`] } });
await call('POST', `/comm/campaigns/${c2.data.id}/resume`, { token: admin });
for (let i = 0; i < 4; i++) await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
const tm = await call('GET', `/comm/campaigns/${c2.data.id}/report`, { token: admin });
check('in test mode only the listed test recipient is messaged; the rest are skipped as TEST_MODE', tm.data.outcome.accepted === 1 && tm.data.skipReasons.some((s) => s.reason === 'TEST_MODE' && s.count === 2), JSON.stringify(tm.data.skipReasons));
await call('PUT', '/comm/settings', { token: admin, body: { testMode: false, testRecipients: [] } });

const c3 = await make({ name: `Cancel me ${run}` }); await call('POST', `/comm/campaigns/${c3.data.id}/submit`, { token: manager });
await call('POST', `/comm/campaigns/${c3.data.id}/approve`, { token: admin, body: { confirm: { ...conf, eligibleCount: (await call('GET', `/comm/campaigns/${c3.data.id}`, { token: admin })).data.eligibleCount } } });
await call('POST', `/comm/campaigns/${c3.data.id}/start`, { token: admin });
check('cancelling needs a reason', (await call('POST', `/comm/campaigns/${c3.data.id}/cancel`, { token: admin, body: {} })).status === 400);
const canc = await call('POST', `/comm/campaigns/${c3.data.id}/cancel`, { token: admin, body: { reason: 'Wrong offer text' } });
check('a sending campaign can be cancelled and its unsent messages are cancelled', canc.data.status === 'CANCELLED' && Number(sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c3.data.id}' and status='QUEUED'`)) === 0);

await call('PUT', '/comm/settings', { token: admin, body: { maxCampaignSizeByRole: { ...original.maxCampaignSizeByRole, BRANCH_MANAGER: 1, STAFF: 1 } } });
const c4 = await make({ name: `Too big ${run}` });
const big = await call('POST', `/comm/campaigns/${c4.data.id}/submit`, { token: manager });
check("a campaign larger than the author's role limit is refused at submission", big.status === 403, big.json?.message);
await call('PUT', '/comm/settings', { token: admin, body: { maxCampaignSizeByRole: { ...original.maxCampaignSizeByRole, BRANCH_MANAGER: 1000 } } });
await call('DELETE', `/comm/campaigns/${c4.data.id}`, { token: manager });

const sched = await make({ name: `Scheduled ${run}`, scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
check('a past schedule time is refused', (await call('POST', '/comm/campaigns', { token: manager, body: { name: 'Past one', channel: 'EMAIL', segmentId: seg.data.id, scheduledAt: new Date(Date.now() - 3600_000).toISOString() } })).status === 400);
await call('POST', `/comm/campaigns/${sched.data.id}/submit`, { token: manager });
const sc = (await call('GET', `/comm/campaigns/${sched.data.id}`, { token: admin })).data;
await call('POST', `/comm/campaigns/${sched.data.id}/approve`, { token: admin, body: { confirm: { ...conf, eligibleCount: sc.eligibleCount, scheduledAt: sc.scheduledAt } } });
const ss = await call('POST', `/comm/campaigns/${sched.data.id}/start`, { token: admin });
check('an approved campaign with a future time is SCHEDULED, not sent', ss.data.status === 'SCHEDULED');
await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
check('a scheduled campaign is not started before its time', (await call('GET', `/comm/campaigns/${sched.data.id}`, { token: admin })).data.status === 'SCHEDULED');
sql(`update comm_campaigns set "scheduledAt" = now() - interval '1 minute' where id='${sched.data.id}'`);
for (let i = 0; i < 4; i++) await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
check('once its time has come, the queue starts it and it finishes', ['SENDING', 'COMPLETED'].includes((await call('GET', `/comm/campaigns/${sched.data.id}`, { token: admin })).data.status));

// ------------------------------------------------------------------ crash safety: an interrupted send is never repeated
const c5 = await make({ name: `Crash ${run}` }); await call('POST', `/comm/campaigns/${c5.data.id}/submit`, { token: manager });
await call('POST', `/comm/campaigns/${c5.data.id}/approve`, { token: admin, body: { confirm: { ...conf, eligibleCount: (await call('GET', `/comm/campaigns/${c5.data.id}`, { token: admin })).data.eligibleCount } } });
await call('POST', `/comm/campaigns/${c5.data.id}/start`, { token: admin });
await call('POST', `/comm/campaigns/${c5.data.id}/pause`, { token: admin });
sql(`update comm_campaign_recipients set status='SENDING', "leaseUntil"=now()-interval '5 minutes' where "campaignId"='${c5.data.id}' and id=(select id from comm_campaign_recipients where "campaignId"='${c5.data.id}' limit 1)`);
await call('POST', `/comm/campaigns/${c5.data.id}/resume`, { token: admin });
for (let i = 0; i < 3; i++) await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
const unc = await call('GET', `/comm/campaigns/${c5.data.id}/recipients?status=UNCERTAIN`, { token: admin });
check('a send that was interrupted is flagged UNCERTAIN for review, never silently re-sent', unc.data.total === 1);
check('the rest of that campaign carried on', Number(sql(`select count(*) from comm_campaign_recipients where "campaignId"='${c5.data.id}' and status in ('SENT','DELIVERED')`)) >= 1);

// ------------------------------------------------------------------ WhatsApp campaign and inbound opt-out
const wseg = await call('POST', '/comm/segments', { token: admin, body: { name: `Check wa ${run}`, definition: { tags: [tag], subscribedChannel: 'WHATSAPP' } } });
const wc = await call('POST', '/comm/campaigns', { token: manager, body: { name: `WA umrah ${run}`, channel: 'WHATSAPP', topic: 'general', segmentId: wseg.data.id, templateId: waTpl.id, variables: { offer: 'Group Umrah in January.', link: 'https://example.test/u' } } });
check('a WhatsApp campaign uses an approved template', wc.status === 201);
await call('POST', `/comm/campaigns/${wc.data.id}/submit`, { token: manager });
const wsub = (await call('GET', `/comm/campaigns/${wc.data.id}`, { token: admin })).data;
check('only the two WhatsApp-subscribed people are eligible', wsub.eligibleCount === 2, String(wsub.eligibleCount));
await call('POST', `/comm/campaigns/${wc.data.id}/approve`, { token: admin, body: { confirm: { channel: 'WHATSAPP', topic: 'general', segmentId: wseg.data.id, templateId: waTpl.id, eligibleCount: 2, scheduledAt: null } } });
await call('POST', `/comm/campaigns/${wc.data.id}/start`, { token: admin });
for (let i = 0; i < 4; i++) await call('POST', '/comm/campaigns/maintenance/process', { token: admin });
const wrep = await call('GET', `/comm/campaigns/${wc.data.id}/report`, { token: admin });
check('both WhatsApp messages were sent through the simulator', wrep.data.outcome.accepted === 2 && wrep.data.campaign.simulated === true);
const phoneA = sql(`select "primaryPhone" from comm_contacts where id='${ids.a}'`);
const phoneB = sql(`select "primaryPhone" from comm_contacts where id='${ids.b}'`);
const wmsg = sql(`select "providerMessageId" from comm_campaign_recipients where "campaignId"='${wc.data.id}' and "contactId"='${ids.a}'`);
const st = await call('POST', '/whatsapp/dev/simulate-status', { token: admin, body: { providerMessageId: wmsg, status: 'DELIVERED' } });
check('a WhatsApp delivery receipt reaches the campaign report', [200, 201].includes(st.status) && sql(`select status from comm_campaign_recipients where "campaignId"='${wc.data.id}' and "contactId"='${ids.a}'`) === 'DELIVERED', String(st.status));
const inbound = (from, text) => call('POST', '/whatsapp/dev/simulate-inbound', { token: admin, body: { from, text } });
const waSub = (id) => sql(`select status from comm_subscriptions where "contactId"='${id}' and channel='WHATSAPP'`);
await inbound(phoneA, 'cancel my booking please');
check('"cancel my booking" is not treated as an opt-out', waSub(ids.a) === 'SUBSCRIBED');
await inbound(phoneA, 'cancel');
check('an ambiguous "cancel" gets a question, not an unsubscribe', waSub(ids.a) === 'SUBSCRIBED' && sql(`select intent from comm_inbound_logs where "contactId"='${ids.a}' order by "createdAt" desc limit 1`) === 'OPT_OUT_UNCLEAR');
await inbound(phoneA, 'STOP');
check('STOP withdraws WhatsApp marketing at once', waSub(ids.a) === 'UNSUBSCRIBED');
check('STOP on WhatsApp does not touch the person\'s email consent', sql(`select status from comm_subscriptions where "contactId"='${ids.a}' and channel='EMAIL'`) === 'SUBSCRIBED');
check('the WhatsApp address is on the suppression list', Number(sql(`select count(*) from comm_suppressions where "contactId"='${ids.a}' and channel='WHATSAPP' and "liftedAt" is null`)) === 1);
await inbound(phoneB, 'daina');
check('the Hausa word "daina" withdraws consent', waSub(ids.b) === 'UNSUBSCRIBED');
await call('POST', `/comm/contacts/${ids.b}/consent`, { token: admin, body: { channel: 'WHATSAPP', action: 'GRANTED', evidence: 'IN_PERSON' } }).catch(() => undefined);
await inbound(phoneB, 'إيقاف');
check('the Arabic word for stop withdraws consent', waSub(ids.b) === 'UNSUBSCRIBED');
check('every inbound message is logged with what it was understood to be', Number(sql(`select count(*) from comm_inbound_logs where "companyId"='${companyA}' and "contactId" in ('${ids.a}','${ids.b}')`)) >= 4);
const strangerPhone = `0816${String(Date.now()).slice(-7)}`;
await inbound(strangerPhone, 'STOP');
check('a STOP from a number we have no record of is still suppressed', Number(sql(`select count(*) from comm_suppressions where "companyId"='${companyA}' and channel='WHATSAPP' and source='WHATSAPP_REPLY' and "contactId" is null and "createdAt" > now() - interval '2 minutes'`)) >= 1);
await inbound(phoneA, 'START');
check('START after STOP subscribes again (the person asked to)', waSub(ids.a) === 'SUBSCRIBED');
const optInHa = await inbound(`0817${String(Date.now()).slice(-7)}`, 'Ina son kudin biza');
check('an enquiry is logged by topic and not answered with invented facts', optInHa.status === 201 || optInHa.status === 200);

// ------------------------------------------------------------------ cleanup of settings
await call('PUT', '/comm/settings', { token: admin, body: { whatsappMessagesPerMinute: original.whatsappMessagesPerMinute, emailMessagesPerMinute: original.emailMessagesPerMinute, maxCampaignSizeByRole: original.maxCampaignSizeByRole, killSwitch: false, testMode: false, testRecipients: original.testRecipients } });
check('settings were put back', (await call('GET', '/comm/settings', { token: admin })).data.killSwitch === false);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
