'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ConsentBadge, subStatus } from '@/components/comm/CommPage';
import { Badge, Empty, Field, Modal, Msg, PageTitle, Pager, Row, Table, btn, btnGhost, card, input, td, useAction } from '@/components/comm/ui';
import { apiDownload, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const KINDS = ['', 'CUSTOMER', 'LEAD', 'SUBSCRIBER', 'STAFF', 'OTHER'];
const LANGS: [string, string][] = [['', 'Any language'], ['en', 'English'], ['ha', 'Hausa'], ['ar', 'Arabic']];
const INTERESTS = ['FLIGHT', 'HOTEL', 'VISA', 'HAJJ', 'UMRAH', 'CORPORATE'];
const PAGE_SIZE = 25;

function AddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: '', phone: '', email: '', preferredLanguage: 'en', country: '', kind: 'OTHER' });
  const [interests, setInterests] = useState<string[]>([]);
  const { act, error, busy } = useAction(onDone);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Add a contact" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full name"><input className={input} value={f.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone / WhatsApp" hint="Any format; stored in international form."><input className={input} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><input className={input} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Language"><select className={input} value={f.preferredLanguage} onChange={(e) => set('preferredLanguage', e.target.value)}>{LANGS.slice(1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Type"><select className={input} value={f.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.slice(1).map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Country"><input className={input} value={f.country} onChange={(e) => set('country', e.target.value)} /></Field>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Interests</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {INTERESTS.map((i) => <label key={i} className="flex items-center gap-1"><input type="checkbox" checked={interests.includes(i)} onChange={(e) => setInterests((c) => (e.target.checked ? [...c, i] : c.filter((x) => x !== i)))} />{i.toLowerCase()}</label>)}
          </div>
        </div>
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Adding a contact does not subscribe them to anything. Marketing consent is recorded separately, per channel, by the person themselves or by you with evidence.</p>
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy || f.fullName.trim().length < 2 || (!f.phone && !f.email)} onClick={() => act(async () => {
            await apiRequest('/comm/contacts', { method: 'POST', body: { ...f, phone: f.phone || undefined, email: f.email || undefined, country: f.country || undefined, interests } });
            onClose();
          })}>{busy ? 'Saving…' : 'Add contact'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<Row | null>(null);
  const { act, error, busy } = useAction(() => undefined);
  const run = (dryRun: boolean) => act(async () => {
    const r = await apiRequest<Row>('/comm/contacts/import', { method: 'POST', body: { csv, dryRun } });
    setReport(r);
    if (!dryRun) onDone();
  });
  return (
    <Modal title="Import contacts from CSV" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">First line: column names. Needs a <b>phone</b> or <b>email</b> column; also understood: name, language, country, kind, tags, interests.</p>
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">An import adds people to your contact list only. It never subscribes anyone to WhatsApp or email marketing, whatever the file says.</p>
        <input type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setReport(null); } }} />
        <textarea className={`${input} font-mono text-xs`} rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setReport(null); }} placeholder={'name,phone,email,language\nAmina Yusuf,08031234567,amina@example.com,ha'} />
        <Msg error={error} />
        {report && (
          <div className={`${card} text-xs`}>
            <p className="font-semibold">{report.dryRun ? 'Check only — nothing was saved' : 'Import finished'}</p>
            <p className="mt-1">{report.rows} rows · {report.created} {report.dryRun ? 'would be added' : 'added'} · {report.duplicates} already exist · {report.invalid} invalid · {report.conflicts} conflicting</p>
            {report.problems.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto text-slate-600">
                {report.problems.map((p: Row) => <li key={`${p.row}-${p.outcome}`}>Line {p.row}: {p.outcome.toLowerCase()} — {p.message}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Close</button>
          <button className={btnGhost} disabled={busy || !csv.trim()} onClick={() => run(true)}>Check the file</button>
          <button className={btn} disabled={busy || !csv.trim() || !report?.dryRun || report.created === 0} onClick={() => run(false)}>Import {report?.dryRun ? report.created : ''}</button>
        </div>
      </div>
    </Modal>
  );
}

function DuplicatesDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data, error: loadError, loading } = useApi<Row[]>('/comm/contacts/duplicates');
  const { act, error, notice, busy } = useAction(onDone);
  return (
    <Modal title="Possible duplicates" onClose={onClose} wide>
      <p className="mb-3 text-xs text-slate-500">Merging keeps one record and folds the others into it. Where the records disagree about consent, the more cautious state wins (any unsubscribe keeps the person unsubscribed).</p>
      <Msg error={loadError ?? error} notice={notice} />
      {loading && <p className="text-sm text-slate-500">Looking…</p>}
      {data?.length === 0 && <Empty>No duplicates found.</Empty>}
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {data?.map((g, i) => (
          <div key={i} className={card}>
            <p className="mb-2 text-xs font-medium text-slate-500">{g.reason === 'SAME_ADDRESS' ? 'Share a phone number or email' : 'Same name'}</p>
            <ul className="space-y-1 text-sm">
              {g.contacts.map((c: Row) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span><b>{c.fullName}</b> <span className="text-xs text-slate-500">{c.primaryPhone ?? ''} {c.primaryEmail ?? ''} · {c.source}</span></span>
                  <button className={btnGhost} disabled={busy} onClick={() => {
                    if (confirm(`Keep "${c.fullName}" and merge the other record(s) into it?`))
                      act(() => apiRequest('/comm/contacts/merge', { method: 'POST', body: { survivorId: c.id, mergeIds: g.contacts.filter((x: Row) => x.id !== c.id).map((x: Row) => x.id) } }), 'Merged.');
                  }}>Keep this one</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ContactsList({ initial }: { initial?: { subscribedTo?: string; subscription?: string } }) {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [language, setLanguage] = useState('');
  const [tag, setTag] = useState('');
  const [channel, setChannel] = useState(initial?.subscribedTo ?? '');
  const [state, setState] = useState(initial?.subscription ?? '');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<'add' | 'import' | 'dupes' | null>(null);
  const bump = () => setRefresh((n) => n + 1);
  const { act, error: actionError, busy } = useAction(() => undefined);

  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim()) qs.set('search', search.trim());
  if (kind) qs.set('kind', kind);
  if (language) qs.set('language', language);
  if (tag.trim()) qs.set('tag', tag.trim());
  if (channel) qs.set('subscribedTo', channel);
  if (channel || state) qs.set('subscription', state || 'SUBSCRIBED');
  const { data, error, loading } = useApi<Row>(`/comm/contacts?${qs.toString()}`, refresh);
  const reset = () => setPage(1);

  return (
    <>
      <PageTitle
        title={initial ? 'Subscribers' : 'Contacts'}
        subtitle={initial ? 'People and their marketing consent, channel by channel. Only “subscribed” people can receive a campaign.' : 'Everyone we may need to contact. A contact is not a subscriber: marketing consent is separate for WhatsApp and for email.'}
        actions={
          <>
            {can('comm:contact:merge') && <button className={btnGhost} onClick={() => setDialog('dupes')}>Find duplicates</button>}
            {can('comm:contact:export') && <button className={btnGhost} disabled={busy} onClick={() => act(() => apiDownload(`/comm/contacts/export?${qs.toString().replace(/page=\d+&?|pageSize=\d+&?/g, '')}`, 'contacts.csv'))}>Export CSV</button>}
            {can('comm:contact:import') && <button className={btnGhost} onClick={() => setDialog('import')}>Import CSV</button>}
            {can('comm:contact:manage') && <button className={btn} onClick={() => setDialog('add')}>Add contact</button>}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Search"><input className={`${input} w-56`} value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} placeholder="Name, phone or email" /></Field>
        <Field label="Type"><select className={`${input} w-36`} value={kind} onChange={(e) => { setKind(e.target.value); reset(); }}>{KINDS.map((k) => <option key={k} value={k}>{k || 'All types'}</option>)}</select></Field>
        <Field label="Language"><select className={`${input} w-36`} value={language} onChange={(e) => { setLanguage(e.target.value); reset(); }}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Tag"><input className={`${input} w-32`} value={tag} onChange={(e) => { setTag(e.target.value); reset(); }} /></Field>
        <Field label="Marketing on"><select className={`${input} w-36`} value={channel} onChange={(e) => { setChannel(e.target.value); reset(); }}><option value="">Any channel</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></select></Field>
        <Field label="Consent state"><select className={`${input} w-52`} value={state} onChange={(e) => { setState(e.target.value); reset(); }}><option value="">{channel ? 'Subscribed' : 'Any'}</option><option value="PENDING_CONFIRMATION">Awaiting confirmation</option><option value="UNSUBSCRIBED">Unsubscribed</option></select></Field>
      </div>
      <Msg error={error ?? actionError} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : data?.items.length === 0 ? (
        <Empty>No contacts match. {can('comm:contact:manage') ? 'Add one, import a file, or share the public sign-up page.' : ''}</Empty>
      ) : (
        <>
          <Table head={['Contact', 'Type', 'Language', 'Marketing consent', 'Tags', '']}>
            {data?.items.map((c: Row) => (
              <tr key={c.id}>
                <td className={td}>
                  <p className="font-medium text-slate-900">{c.fullName}</p>
                  <p className="text-xs text-slate-500">{[c.primaryPhone, c.primaryEmail].filter(Boolean).join(' · ')}</p>
                </td>
                <td className={td}><Badge value={c.kind} /></td>
                <td className={td}>{c.preferredLanguage}</td>
                <td className={td}>
                  <ConsentBadge channel="WHATSAPP" status={subStatus(c, 'WHATSAPP')} />
                  <br />
                  <ConsentBadge channel="EMAIL" status={subStatus(c, 'EMAIL')} />
                </td>
                <td className={td}><span className="text-xs text-slate-500">{c.tags.join(', ') || '—'}</span></td>
                <td className={`${td} text-right`}><Link className="text-xs font-medium text-amber-700 hover:underline" href={`/admin/communication/contacts/${c.id}`}>Open</Link></td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
      {dialog === 'add' && <AddDialog onClose={() => setDialog(null)} onDone={bump} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={bump} />}
      {dialog === 'dupes' && <DuplicatesDialog onClose={() => setDialog(null)} onDone={bump} />}
    </>
  );
}
