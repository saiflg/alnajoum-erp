'use client';

import { useMemo, useState } from 'react';
import { EXCLUSION_LABELS } from '@/components/comm/labels';
import { Field, Modal, Msg, Row, btn, btnGhost, input, useAction } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Values the system fills in for each person; the author never types these. */
const PER_PERSON = new Set(['first_name', 'name', 'company_name', 'unsubscribe_link', 'preferences_link', 'contact_phone']);

const VALUE_LABELS: Record<string, string> = {
  offer: 'The offer (one or two sentences)',
  package_name: 'Package name',
  price: 'Price (as you want it written)',
  destination: 'Destination',
  departure_date: 'Departure date',
  valid_until: 'Offer valid until',
  link: 'Link to the details',
  message: 'Message',
};

/**
 * Create or edit a draft campaign. The audience count shown while editing is worked out from live consent records, so
 * the author sees how many people will really receive it, and why the others are left out.
 */
export function CampaignBuilder({ channel, campaign, onClose, onDone }: { channel: 'WHATSAPP' | 'EMAIL'; campaign?: Row; onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState<string>(campaign?.name ?? '');
  const [description, setDescription] = useState<string>(campaign?.description ?? '');
  const [topic, setTopic] = useState<string>(campaign?.topic ?? 'general');
  const [segmentId, setSegmentId] = useState<string>(campaign?.segmentId ?? '');
  const [templateId, setTemplateId] = useState<string>(campaign?.templateId ?? '');
  const [own, setOwn] = useState<boolean>(channel === 'EMAIL' && !!campaign && !campaign.templateId && !!campaign.subject);
  const [subject, setSubject] = useState<string>(campaign?.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState<string>(campaign?.bodyHtml ?? '');
  const [bodyText, setBodyText] = useState<string>(campaign?.bodyText ?? '');
  const [values, setValues] = useState<Record<string, string>>(campaign?.variables ?? {});
  const [when, setWhen] = useState<string>(campaign?.scheduledAt ? toLocalInput(campaign.scheduledAt) : '');
  const { data: settings } = useApi<Row>('/comm/settings');
  const { data: segments } = useApi<Row[]>('/comm/segments');
  const { data: templates } = useApi<Row[]>(`/comm/templates?channel=${channel}&category=MARKETING`);
  const { data: audience, loading: counting } = useApi<Row>(segmentId ? `/comm/segments/${segmentId}/audience?channel=${channel}&topic=${topic}` : null);
  const { act, error, busy } = useAction(() => undefined);

  const chosen = templates?.find((t) => t.id === templateId);
  const neededValues = useMemo(() => {
    const vars: string[] = own ? extract(subject, bodyHtml, bodyText) : (chosen?.variables ?? []);
    return vars.filter((v) => !PER_PERSON.has(v));
  }, [own, chosen, subject, bodyHtml, bodyText]);

  async function save() {
    const body: Record<string, unknown> = {
      name, description: description || undefined, topic, segmentId: segmentId || undefined,
      variables: Object.fromEntries(neededValues.map((v) => [v, values[v] ?? ''])),
      ...(when ? { scheduledAt: new Date(when).toISOString() } : campaign ? { scheduledAt: null } : {}),
    };
    if (own) Object.assign(body, { subject, bodyHtml: bodyHtml || undefined, bodyText: bodyText || undefined, templateId: campaign ? '' : undefined });
    else body.templateId = templateId || undefined;
    if (campaign) {
      await apiRequest(`/comm/campaigns/${campaign.id}`, { method: 'PUT', body });
      onDone(campaign.id);
    } else {
      const created = await apiRequest<Row>('/comm/campaigns', { method: 'POST', body: { ...body, channel } });
      onDone(created.id);
    }
  }

  return (
    <Modal title={campaign ? 'Edit campaign' : `New ${channel === 'EMAIL' ? 'email' : 'WhatsApp'} campaign`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Topic" hint="Only people who chose this topic (or everything) receive it."><select className={input} value={topic} onChange={(e) => setTopic(e.target.value)}><option value="general">General</option>{settings?.topics?.map((t: Row) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
        </div>
        <Field label="Note for reviewers (optional)"><input className={input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field>

        <Field label="Who it goes to" hint="A segment only lists people; consent is checked for each of them.">
          <select className={input} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
            <option value="">Choose a segment…</option>
            {segments?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {segmentId && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            {counting && !audience ? <p className="text-xs text-slate-500">Counting…</p> : audience && (
              <>
                <p><b>{audience.eligible}</b> of {audience.total} people can receive this {channel === 'EMAIL' ? 'email' : 'WhatsApp message'} now · <b>{audience.excluded}</b> left out</p>
                {audience.excluded > 0 && <ul className="mt-1 text-xs text-slate-600">{Object.entries<number>(audience.breakdown).map(([k, n]) => <li key={k}>{n} — {EXCLUSION_LABELS[k] ?? k}</li>)}</ul>}
              </>
            )}
          </div>
        )}

        {channel === 'EMAIL' && (
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1"><input type="radio" checked={!own} onChange={() => setOwn(false)} /> Use a template</label>
            <label className="flex items-center gap-1"><input type="radio" checked={own} onChange={() => setOwn(true)} /> Write my own</label>
          </div>
        )}
        {!own && (
          <Field label={channel === 'WHATSAPP' ? 'WhatsApp message template' : 'Email template'} hint={channel === 'WHATSAPP' ? 'WhatsApp only allows approved templates for messages we start.' : undefined}>
            <select className={input} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a template…</option>
              {templates?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language}){channel === 'WHATSAPP' ? ` — ${t.approval.toLowerCase()}` : ''}</option>)}
            </select>
          </Field>
        )}
        {chosen && <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-600">{chosen.subject ? `Subject: ${chosen.subject}\n` : ''}{chosen.bodyText}</p>}
        {own && (
          <div className="space-y-3">
            <Field label="Subject"><input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></Field>
            <Field label="Message (HTML)" hint="Scripts, forms and styling are removed when it is saved. {{first_name}} and other {{values}} are filled in. A footer with an unsubscribe link is always added.">
              <textarea className={`${input} font-mono text-xs`} rows={8} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
            </Field>
            <Field label="Plain-text version" hint="Shown by mail programs that do not show HTML. Made from the HTML if left empty.">
              <textarea className={`${input} font-mono text-xs`} rows={4} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </Field>
          </div>
        )}

        {neededValues.length > 0 && (
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-600">Fill in the details</legend>
            <p className="mb-2 text-[11px] text-slate-400">Nothing is guessed: a campaign cannot be submitted while one of these is empty.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {neededValues.map((v) => (
                <Field key={v} label={VALUE_LABELS[v] ?? v.replace(/_/g, ' ')}>
                  <input className={input} value={values[v] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))} maxLength={1000} />
                </Field>
              ))}
            </div>
          </fieldset>
        )}

        <Field label={`Send later (optional) — your time zone; sent on the ${settings?.businessTimezone ?? 'business'} clock`} hint="Leave empty to send as soon as it is approved and you press Start.">
          <input className={input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>

        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy || name.trim().length < 3} onClick={() => act(save)}>{busy ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>
    </Modal>
  );
}

function extract(...texts: string[]): string[] {
  const seen: string[] = [];
  for (const t of texts) for (const m of t.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi)) if (!seen.includes(m[1].toLowerCase())) seen.push(m[1].toLowerCase());
  return seen;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
