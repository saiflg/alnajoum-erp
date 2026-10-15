'use client';

import { useEffect, useState } from 'react';
import { CommPage } from '@/components/comm/CommPage';
import { Badge, Empty, Field, Modal, Msg, PageTitle, Row, Table, Tabs, btn, btnGhost, card, input, td, useAction } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

type Channel = 'EMAIL' | 'WHATSAPP';
const COMMON = 'first_name, name, company_name, offer, package_name, price, destination, departure_date, valid_until, link, contact_phone, message';
const SERVICE = 'booking_ref, amount, due_date, status, document_name';

function Preview({ id, onClose }: { id: string; onClose: () => void }) {
  const [pv, setPv] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiRequest<Row>(`/comm/templates/${id}/preview`, { method: 'POST', body: {} })
      .then((r) => !cancelled && setPv(r))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Failed'));
    return () => { cancelled = true; };
  }, [id]);
  return (
    <Modal title="Preview" onClose={onClose} wide>
      <p className="mb-2 text-xs text-slate-500">Made-up sample details, so it cannot be mistaken for a real message.</p>
      <Msg error={err} />
      {!pv && !err && <p className="text-sm text-slate-500">Loading…</p>}
      {pv?.html && (<><p className="mb-2 text-sm">Subject: <b>{pv.subject}</b></p><iframe title="Template preview" sandbox="" srcDoc={pv.html} className="h-80 w-full rounded border border-slate-200 bg-white" /></>)}
      {pv && !pv.html && <div className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm">{pv.text}</div>}
    </Modal>
  );
}

function Editor({ t, channel, onClose, onDone }: { t: Row | null; channel: Channel; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    key: t?.key ?? (channel === 'WHATSAPP' ? 'wa_' : ''), name: t?.name ?? '', category: t?.category ?? 'MARKETING', language: t?.language ?? 'en',
    subject: t?.subject ?? '', bodyHtml: t?.bodyHtml ?? '', bodyText: t?.bodyText ?? '', whatsappTemplateName: t?.whatsappTemplateName ?? '',
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const { act, error, busy } = useAction(onDone);
  const marketing = f.category === 'MARKETING';
  return (
    <Modal title={t ? 'Edit template' : `New ${channel === 'EMAIL' ? 'email' : 'WhatsApp'} template`} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Name"><input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Key" hint="Letters, digits, underscore."><input className={input} value={f.key} disabled={!!t} onChange={(e) => set('key', e.target.value)} /></Field>
          <Field label="Kind"><select className={input} value={f.category} onChange={(e) => set('category', e.target.value)}><option value="MARKETING">Promotional</option><option value="UTILITY">Service (about a booking)</option><option value="TRANSACTIONAL">Transactional</option></select></Field>
          <Field label="Language"><select className={input} value={f.language} disabled={!!t} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="ha">Hausa</option><option value="ar">Arabic</option></select></Field>
        </div>
        {channel === 'EMAIL' && <Field label="Subject"><input className={input} value={f.subject} onChange={(e) => set('subject', e.target.value)} /></Field>}
        {channel === 'WHATSAPP' && <Field label="Name at the provider" hint="Exactly as it is (or will be) named in Meta’s template manager: lower-case letters, digits, underscores."><input className={input} value={f.whatsappTemplateName} onChange={(e) => set('whatsappTemplateName', e.target.value)} /></Field>}
        {channel === 'EMAIL' && <Field label="Message (HTML)" hint="Scripts, forms and styling are removed when saved."><textarea className={`${input} font-mono text-xs`} rows={7} value={f.bodyHtml} onChange={(e) => set('bodyHtml', e.target.value)} /></Field>}
        <Field label={channel === 'EMAIL' ? 'Plain-text version' : 'Message text'} hint={channel === 'WHATSAPP' ? (marketing ? 'A promotional message must say how to opt out (“Reply STOP to unsubscribe”).' : undefined) : undefined}>
          <textarea className={`${input} text-sm`} rows={channel === 'EMAIL' ? 4 : 6} value={f.bodyText} onChange={(e) => set('bodyText', e.target.value)} maxLength={channel === 'WHATSAPP' ? 1024 : 20000} />
        </Field>
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">Insert details as {'{{first_name}}'}. Allowed: {COMMON}{channel === 'EMAIL' ? ', unsubscribe_link, preferences_link' : ''}{marketing ? '' : `; and, because this is not promotional: ${SERVICE}`}. Booking and payment details are never allowed in a promotional message.</p>
        {t?.channel === 'WHATSAPP' && t.approval !== 'DRAFT' && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Changing the wording sends this template back to draft: the earlier approval was for the old text.</p>}
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy || !f.name || !f.bodyText} onClick={() => act(async () => {
            if (t) await apiRequest(`/comm/templates/${t.id}`, { method: 'PUT', body: { name: f.name, category: f.category, subject: channel === 'EMAIL' ? f.subject : undefined, bodyHtml: channel === 'EMAIL' ? f.bodyHtml : undefined, bodyText: f.bodyText, whatsappTemplateName: channel === 'WHATSAPP' ? f.whatsappTemplateName : undefined } });
            else await apiRequest('/comm/templates', { method: 'POST', body: { key: f.key, name: f.name, channel, category: f.category, language: f.language, subject: channel === 'EMAIL' ? f.subject : undefined, bodyHtml: channel === 'EMAIL' && f.bodyHtml ? f.bodyHtml : undefined, bodyText: f.bodyText, whatsappTemplateName: channel === 'WHATSAPP' ? f.whatsappTemplateName : undefined } });
            onClose();
          })}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

function Templates() {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const bump = () => setRefresh((n) => n + 1);
  const { data, error, loading } = useApi<Row[]>(can('comm:campaign:read') ? `/comm/templates?channel=${channel}` : null, refresh);
  const { data: health } = useApi<Row>(can('comm:campaign:read') ? '/comm/integrations/health' : null);
  const { act, error: actionError, notice, busy } = useAction(bump);
  const simulator = health?.whatsapp?.mode === 'SIMULATOR';

  return (
    <>
      <PageTitle title="Message templates" subtitle="Reusable wording for campaigns and automatic service messages. No prices, dates or booking facts are written into a template: they are filled in from details you give, or from the person’s own record." actions={
        <>
          {channel === 'WHATSAPP' && can('comm:template:manage') && <button className={btnGhost} disabled={busy} onClick={() => act(async () => { const r = await apiRequest<Row>('/comm/templates/sync', { method: 'POST' }); if (r.note) throw new Error(r.note); }, 'Synchronised with the provider.')}>Synchronise approvals</button>}
          {can('comm:template:manage') && <button className={btn} onClick={() => setEditing('new')}>New template</button>}
        </>
      } />
      <Tabs tabs={[['EMAIL', 'Email'], ['WHATSAPP', 'WhatsApp']]} value={channel} onChange={setChannel} />
      {channel === 'WHATSAPP' && (
        <p className={`${card} mb-4 text-xs text-slate-600`}>
          WhatsApp only lets a business start a conversation with a template that Meta has approved. {simulator
            ? <b>The simulator is active: approval below is only a local label for trying things out, and nothing is submitted to Meta.</b>
            : 'Submit each template in Meta’s template manager, then press “Synchronise approvals”.'}
        </p>
      )}
      <Msg error={error ?? actionError} notice={notice} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : data?.length === 0 ? <Empty>No templates.</Empty> : (
        <Table head={['Template', 'Kind', 'Language', ...(channel === 'WHATSAPP' ? ['Approval'] : ['Subject']), '']}>
          {data?.map((t) => (
            <tr key={t.id}>
              <td className={td}><p className="font-medium text-slate-900">{t.name}</p><p className="text-xs text-slate-500">{t.key}</p></td>
              <td className={td}>{t.category === 'MARKETING' ? 'Promotional' : t.category === 'UTILITY' ? 'Service' : 'Transactional'}</td>
              <td className={td}>{t.language}</td>
              <td className={td}>{channel === 'WHATSAPP' ? <Badge value={t.approval} /> : <span className="text-xs text-slate-600">{t.subject}</span>}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                <button className={btnGhost} onClick={() => setPreview(t.id)}>Preview</button>{' '}
                {can('comm:template:manage') && <button className={btnGhost} onClick={() => setEditing(t)}>Edit</button>}{' '}
                {channel === 'WHATSAPP' && can('comm:template:manage') && ['DRAFT', 'REJECTED'].includes(t.approval) && !simulator && <button className={btnGhost} disabled={busy} onClick={() => act(() => apiRequest(`/comm/templates/${t.id}/submitted`, { method: 'POST' }), 'Marked as submitted.')}>I submitted it</button>}{' '}
                {channel === 'WHATSAPP' && can('comm:template:manage') && simulator && t.approval !== 'APPROVED' && <button className={btnGhost} disabled={busy} onClick={() => act(() => apiRequest(`/comm/templates/${t.id}/simulate-approval`, { method: 'POST' }), 'Marked approved (simulator only).')}>Simulate approval</button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <Editor t={editing === 'new' ? null : editing} channel={channel} onClose={() => setEditing(null)} onDone={bump} />}
      {preview && <Preview id={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

export default function TemplatesPage() {
  return (
    <CommPage title="Message templates">
      <Templates />
    </CommPage>
  );
}
