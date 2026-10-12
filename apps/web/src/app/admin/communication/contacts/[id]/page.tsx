'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CommPage, ConsentBadge, subStatus } from '@/components/comm/CommPage';
import { Badge, Empty, Field, Modal, Msg, PageTitle, Row, Table, btn, btnDanger, btnGhost, card, input, td, useAction, when } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const INTERESTS = ['FLIGHT', 'HOTEL', 'VISA', 'HAJJ', 'UMRAH', 'CORPORATE'];
const EVIDENCE: [string, string][] = [
  ['WRITTEN_FORM', 'Signed or written form'],
  ['VERBAL_RECORDED', 'Recorded phone call'],
  ['IN_PERSON', 'In person, noted at the counter'],
  ['EMAIL_REPLY', 'Email reply from the person'],
  ['WHATSAPP_REPLY', 'WhatsApp reply from the person'],
  ['OTHER', 'Other (explain in the note)'],
];

function EditDialog({ c, onClose, onDone }: { c: Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: c.fullName, phone: c.primaryPhone ?? '', email: c.primaryEmail ?? '', preferredLanguage: c.preferredLanguage, country: c.country ?? '', kind: c.kind, tags: c.tags.join(', ') });
  const [interests, setInterests] = useState<string[]>(c.interests);
  const { act, error, busy } = useAction(onDone);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const addressChanged = f.phone !== (c.primaryPhone ?? '') || f.email !== (c.primaryEmail ?? '');
  return (
    <Modal title="Edit contact" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full name"><input className={input} value={f.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone / WhatsApp"><input className={input} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><input className={input} value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Language"><select className={input} value={f.preferredLanguage} onChange={(e) => set('preferredLanguage', e.target.value)}><option value="en">English</option><option value="ha">Hausa</option><option value="ar">Arabic</option></select></Field>
          <Field label="Type"><select className={input} value={f.kind} onChange={(e) => set('kind', e.target.value)}>{['CUSTOMER', 'LEAD', 'SUBSCRIBER', 'STAFF', 'OTHER'].map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Country"><input className={input} value={f.country} onChange={(e) => set('country', e.target.value)} /></Field>
          <Field label="Tags" hint="Comma separated."><input className={input} value={f.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {INTERESTS.map((i) => <label key={i} className="flex items-center gap-1"><input type="checkbox" checked={interests.includes(i)} onChange={(e) => setInterests((x) => (e.target.checked ? [...x, i] : x.filter((y) => y !== i)))} />{i.toLowerCase()}</label>)}
        </div>
        {addressChanged && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Consent was given for the old number or address; it does not carry over to a new one.</p>}
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy} onClick={() => act(async () => {
            await apiRequest(`/comm/contacts/${c.id}`, { method: 'PUT', body: { fullName: f.fullName, phone: f.phone, email: f.email, preferredLanguage: f.preferredLanguage, country: f.country, kind: f.kind, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean), interests } });
            onClose();
          })}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ConsentDialog({ c, channel, onClose, onDone }: { c: Row; channel: 'WHATSAPP' | 'EMAIL'; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<'GRANTED' | 'WITHDRAWN'>('GRANTED');
  const [evidence, setEvidence] = useState('WRITTEN_FORM');
  const [note, setNote] = useState('');
  const { data: settings } = useApi<Row>('/comm/settings');
  const { act, error, busy } = useAction(onDone);
  const label = channel === 'EMAIL' ? 'email' : 'WhatsApp';
  return (
    <Modal title={`Record ${label} consent`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Use this only for consent the person gave outside the website, or for a withdrawal they told you about. It is written to the consent history with your name.</p>
        <Field label="What happened">
          <select className={input} value={action} onChange={(e) => setAction(e.target.value as 'GRANTED' | 'WITHDRAWN')}>
            <option value="GRANTED">They agreed to receive {label} marketing</option>
            <option value="WITHDRAWN">They asked us to stop {label} marketing</option>
          </select>
        </Field>
        {action === 'GRANTED' && (
          <>
            <Field label="Evidence you hold"><select className={input} value={evidence} onChange={(e) => setEvidence(e.target.value)}>{EVIDENCE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Note (where the evidence is kept, date…)"><input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
            {settings && <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">Wording on file (version {settings.consentTextVersion}): “{channel === 'EMAIL' ? settings.consentTextEmail : settings.consentTextWhatsApp}”</p>}
          </>
        )}
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy} onClick={() => act(async () => {
            await apiRequest(`/comm/contacts/${c.id}/consent`, { method: 'POST', body: { channel, action, ...(action === 'GRANTED' ? { evidence, note: note || undefined } : { note: note || undefined }) } });
            onClose();
          })}>{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </Modal>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<'edit' | 'WHATSAPP' | 'EMAIL' | null>(null);
  const bump = () => setRefresh((n) => n + 1);
  const { data: c, error, loading } = useApi<Row>(`/comm/contacts/${id}`, refresh);
  const { data: history } = useApi<Row[]>(`/comm/contacts/${id}/consent`, refresh);
  const { act, error: actionError, notice, busy } = useAction(bump);

  if (error) return <Msg error={error} />;
  if (loading || !c) return <p className="text-sm text-slate-500">Loading…</p>;
  const active = c.status === 'ACTIVE';

  return (
    <>
      <PageTitle
        title={c.fullName}
        subtitle={`${c.kind.toLowerCase()} · added from ${c.source.toLowerCase().replace(/_/g, ' ')} on ${new Date(c.createdAt).toLocaleDateString()}`}
        actions={
          <>
            <Link className={btnGhost} href="/admin/communication/contacts">← Contacts</Link>
            {active && can('comm:contact:manage') && <button className={btn} onClick={() => setDialog('edit')}>Edit</button>}
          </>
        }
      />
      <Msg error={actionError} notice={notice} />
      {c.status !== 'ACTIVE' && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This record is {c.status === 'MERGED' ? <>merged into <Link className="underline" href={`/admin/communication/contacts/${c.mergedIntoId}`}>another contact</Link></> : 'erased'}. It cannot be messaged.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-sm font-semibold">Details</h2>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">Phone</dt><dd>{c.primaryPhone ?? '—'}</dd>
            <dt className="text-slate-500">Email</dt><dd>{c.primaryEmail ?? '—'}</dd>
            <dt className="text-slate-500">Language</dt><dd>{c.preferredLanguage}</dd>
            <dt className="text-slate-500">Country</dt><dd>{c.country ?? '—'}</dd>
            <dt className="text-slate-500">Tags</dt><dd>{c.tags.join(', ') || '—'}</dd>
            <dt className="text-slate-500">Interests</dt><dd>{c.interests.map((i: string) => i.toLowerCase()).join(', ') || '—'}</dd>
            <dt className="text-slate-500">Last messaged</dt><dd>{when(c.lastCommunicatedAt)}</dd>
          </dl>
          {c.customerId && <p className="mt-3 text-xs"><Link className="text-amber-700 hover:underline" href={`/admin/customers/${c.customerId}`}>Open the customer record</Link></p>}
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">Marketing consent</h2>
          <p className="mt-1 text-xs text-slate-500">Separate for each channel. Messages about this person&apos;s own bookings and payments do not depend on it.</p>
          {(['WHATSAPP', 'EMAIL'] as const).map((ch) => {
            const s = c.subscriptions.find((x: Row) => x.channel === ch);
            const status = subStatus(c, ch);
            const hasAddress = ch === 'EMAIL' ? !!c.primaryEmail : !!c.primaryPhone;
            return (
              <div key={ch} className="mt-3 flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                <div>
                  <ConsentBadge channel={ch} status={status} />
                  <p className="mt-1 text-xs text-slate-500">
                    {s?.topics?.length ? `Topics: ${s.topics.join(', ')}` : status === 'SUBSCRIBED' ? 'All topics' : ''}
                    {s?.subscribedAt && status === 'SUBSCRIBED' ? ` · since ${new Date(s.subscribedAt).toLocaleDateString()}` : ''}
                    {s?.unsubscribedAt && status === 'UNSUBSCRIBED' ? ` · on ${new Date(s.unsubscribedAt).toLocaleDateString()}` : ''}
                  </p>
                  {!hasAddress && <p className="text-xs text-slate-400">No {ch === 'EMAIL' ? 'email address' : 'phone number'} on file.</p>}
                </div>
                {active && hasAddress && can('comm:consent:manage') && <button className={btnGhost} onClick={() => setDialog(ch)}>Record…</button>}
              </div>
            );
          })}
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Consent history</h2>
        {!history ? <p className="text-sm text-slate-500">Loading…</p> : history.length === 0 ? <Empty>No consent has been recorded for this contact.</Empty> : (
          <Table head={['When', 'Channel', 'What', 'How', 'Wording version', 'Evidence']}>
            {history.map((h) => (
              <tr key={h.id}>
                <td className={td}>{when(h.createdAt)}</td>
                <td className={td}>{h.channel.toLowerCase()}</td>
                <td className={td}><Badge value={h.action} /></td>
                <td className={td}>{h.source.toLowerCase().replace(/_/g, ' ')}</td>
                <td className={td}>{h.textVersion ?? '—'}</td>
                <td className={td}><span className="text-xs text-slate-500">{h.evidence?.kind ? String(h.evidence.kind).toLowerCase().replace(/_/g, ' ') : h.evidence?.page ?? '—'}{h.evidence?.note ? ` — ${h.evidence.note}` : ''}</span></td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {active && (can('comm:contact:export') || can('comm:contact:merge')) && (
        <section className={`${card} mt-6`}>
          <h2 className="text-sm font-semibold">Data protection</h2>
          <p className="mt-1 text-xs text-slate-500">For a person&apos;s request to see or erase what we hold. Erasing removes their name and addresses; their do-not-contact choice is kept (as a one-way fingerprint) so they are not messaged again.</p>
          <div className="mt-3 flex gap-2">
            {can('comm:contact:export') && (
              <button className={btnGhost} disabled={busy} onClick={() => act(async () => {
                const d = await apiRequest<Row>(`/comm/contacts/${id}/export`);
                const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
                const a = document.createElement('a'); a.href = url; a.download = `contact-${id}.json`; a.click(); URL.revokeObjectURL(url);
              })}>Download everything we hold</button>
            )}
            {can('comm:contact:merge') && (
              <button className={btnDanger} disabled={busy} onClick={() => {
                if (confirm(`Erase ${c.fullName}? Their name, phone number and email are removed. This cannot be undone.`))
                  act(async () => { await apiRequest(`/comm/contacts/${id}`, { method: 'DELETE' }); router.push('/admin/communication/contacts'); });
              }}>Erase this person</button>
            )}
          </div>
        </section>
      )}

      {dialog === 'edit' && <EditDialog c={c} onClose={() => setDialog(null)} onDone={bump} />}
      {(dialog === 'WHATSAPP' || dialog === 'EMAIL') && <ConsentDialog c={c} channel={dialog} onClose={() => setDialog(null)} onDone={bump} />}
    </>
  );
}

export default function ContactDetailPage() {
  return (
    <CommPage title="Contact">
      <Detail />
    </CommPage>
  );
}
