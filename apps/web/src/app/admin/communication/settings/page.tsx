'use client';

import { useState } from 'react';
import { CommPage } from '@/components/comm/CommPage';
import { Field, Msg, PageTitle, Row, btn, card, input, useAction } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

type Form = Record<string, unknown>;

function Settings() {
  const { user } = useAuth();
  const editable = !!user?.permissions.includes('comm:settings:manage');
  const [refresh, setRefresh] = useState(0);
  const { data: s, error: loadError } = useApi<Row>('/comm/settings', refresh);
  const { act, error, notice, busy } = useAction(() => setRefresh((n) => n + 1));
  const [edits, setEdits] = useState<Form>({});

  if (loadError) return <Msg error={loadError} />;
  if (!s) return <p className="text-sm text-slate-500">Loading…</p>;

  const val = (k: string): unknown => (k in edits ? edits[k] : s[k]);
  const set = (k: string, v: unknown) => setEdits((e) => ({ ...e, [k]: v }));
  const text = (k: string, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={hint}>
      <input className={input} type={type} disabled={!editable} value={String(val(k) ?? '')} onChange={(e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)} />
    </Field>
  );
  const flag = (k: string, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input className="mt-1" type="checkbox" disabled={!editable} checked={!!val(k)} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</span>
    </label>
  );
  const sizes = (val('maxCampaignSizeByRole') ?? {}) as Record<string, number>;

  async function save() {
    const body: Form = { ...edits };
    if (typeof body.testRecipients === 'string') body.testRecipients = (body.testRecipients as string).split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    await apiRequest('/comm/settings', { method: 'PUT', body });
    setEdits({});
  }

  return (
    <>
      <PageTitle title="Integration settings" subtitle="Sender identity, sending limits, safety switches and the wording of the consent people agree to." />
      <Msg error={error} notice={notice} />
      {s.killSwitch && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">The kill switch is ON: no bulk campaign or automated promotion is being sent.</p>}
      <div className="grid gap-6 xl:grid-cols-2">
        <section className={`${card} space-y-3`}>
          <h2 className="text-sm font-semibold">Sender</h2>
          {text('senderName', 'Sender name')}
          {text('fromEmail', 'From email address', 'Must be an address your email provider has verified. Not used until an email provider is configured.')}
          {text('replyTo', 'Reply-to address')}
          {text('businessTimezone', 'Business time zone', 'Scheduled sends and reminders follow this clock (default Africa/Lagos).')}
        </section>

        <section className={`${card} space-y-3`}>
          <h2 className="text-sm font-semibold">Limits and safety</h2>
          <div className="grid grid-cols-3 gap-3">
            {text('whatsappMessagesPerMinute', 'WhatsApp / minute', undefined, 'number')}
            {text('emailMessagesPerMinute', 'Email / minute', undefined, 'number')}
            {text('dailySendCap', 'Daily cap', undefined, 'number')}
          </div>
          {flag('killSwitch', 'Kill switch — stop every bulk send now', 'Takes effect within seconds; queued messages are held, not lost.')}
          {flag('testMode', 'Test mode — only send to the test recipients below', 'Use this until a provider is verified.')}
          <Field label="Test recipients (phones or emails, comma separated)">
            <textarea className={input} rows={2} disabled={!editable} value={Array.isArray(val('testRecipients')) ? (val('testRecipients') as string[]).join(', ') : String(val('testRecipients') ?? '')} onChange={(e) => set('testRecipients', e.target.value)} />
          </Field>
          {flag('approvalRequired', 'A second person must approve every campaign', 'The approver can never be the person who wrote it.')}
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Largest audience each role may send to without a higher role</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(sizes).map(([role, n]) => (
                <label key={role} className="flex items-center justify-between gap-2"><span className="text-xs text-slate-600">{role.replace(/_/g, ' ').toLowerCase()}</span>
                  <input className={`${input} w-28`} type="number" min={0} disabled={!editable} value={n} onChange={(e) => set('maxCampaignSizeByRole', { ...sizes, [role]: Number(e.target.value) })} />
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className={`${card} space-y-3 xl:col-span-2`}>
          <h2 className="text-sm font-semibold">Consent wording</h2>
          <p className="text-xs text-slate-500">Shown on the public sign-up page and stored with every consent as evidence. Changing the wording raises the version number; people who agreed to the older wording keep that record.</p>
          <p className="text-xs text-slate-600">Current version: <b>{String(s.consentTextVersion)}</b></p>
          <Field label="WhatsApp consent text"><textarea className={input} rows={2} disabled={!editable} value={String(val('consentTextWhatsApp') ?? '')} onChange={(e) => set('consentTextWhatsApp', e.target.value)} /></Field>
          <Field label="Email consent text"><textarea className={input} rows={2} disabled={!editable} value={String(val('consentTextEmail') ?? '')} onChange={(e) => set('consentTextEmail', e.target.value)} /></Field>
          {text('privacyNoticeUrl', 'Privacy notice link', 'Shown beside the sign-up form. Leave empty if you have not published one.')}
          {flag('doubleOptInEmail', 'Ask email subscribers to confirm by link (double opt-in)', 'Strongly recommended. WhatsApp sign-ups from the website are always confirmed.')}
        </section>

        <section className={`${card} space-y-3 xl:col-span-2`}>
          <h2 className="text-sm font-semibold">AI assistant</h2>
          {flag('aiMayUseContactData', 'Let the AI assistant see contact names and masked addresses', 'Off by default. When off, the assistant only ever sees counts and segment definitions — never a contact list. Phone numbers and emails are never shown to it either way.')}
        </section>
      </div>
      {editable ? (
        <div className="mt-6"><button className={btn} disabled={busy || Object.keys(edits).length === 0} onClick={() => act(save, 'Settings saved.')}>Save settings</button></div>
      ) : <p className="mt-6 text-xs text-slate-500">You can view these settings; changing them needs the Communication settings permission.</p>}
    </>
  );
}

export default function CommSettingsPage() {
  return (
    <CommPage title="Integration settings">
      <Settings />
    </CommPage>
  );
}
