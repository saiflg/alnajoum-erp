'use client';

import { useState } from 'react';
import { CommPage } from '@/components/comm/CommPage';
import { EXCLUSION_LABELS } from '@/components/comm/labels';
import { Empty, Field, Modal, Msg, PageTitle, Row, Table, btn, btnDanger, btnGhost, card, input, td, useAction } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const INTERESTS = ['FLIGHT', 'HOTEL', 'VISA', 'HAJJ', 'UMRAH', 'CORPORATE'];
const KINDS = ['CUSTOMER', 'LEAD', 'SUBSCRIBER', 'STAFF', 'OTHER'];

type Def = {
  subscribedChannel?: string; topics?: string[]; kinds?: string[]; languages?: string[]; interests?: string[]; tags?: string[];
  countries?: string[]; hasPhone?: boolean; hasEmail?: boolean; upcomingTravelWithinDays?: number; notContactedForDays?: number;
};

function describe(d: Def): string {
  const bits: string[] = [];
  if (d.subscribedChannel) bits.push(`subscribed on ${d.subscribedChannel.toLowerCase()}${d.topics?.length ? ` to ${d.topics.join('/')}` : ''}`);
  if (d.kinds?.length) bits.push(`type ${d.kinds.join('/').toLowerCase()}`);
  if (d.languages?.length) bits.push(`language ${d.languages.join('/')}`);
  if (d.interests?.length) bits.push(`interested in ${d.interests.join('/').toLowerCase()}`);
  if (d.tags?.length) bits.push(`tagged ${d.tags.join('/')}`);
  if (d.countries?.length) bits.push(`in ${d.countries.join('/')}`);
  if (d.hasPhone) bits.push('has a phone');
  if (d.hasEmail) bits.push('has an email');
  if (d.upcomingTravelWithinDays) bits.push(`travelling within ${d.upcomingTravelWithinDays} days`);
  if (d.notContactedForDays) bits.push(`not messaged for ${d.notContactedForDays} days`);
  return bits.join(' · ') || 'everyone';
}

function Preview({ definition }: { definition: Def }) {
  const [channel, setChannel] = useState('WHATSAPP');
  const [topic, setTopic] = useState('general');
  const { data: settings } = useApi<Row>('/comm/settings');
  const [result, setResult] = useState<Row | null>(null);
  const { act, error, busy } = useAction(() => undefined);
  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm">
      <p className="mb-2 text-xs font-semibold text-slate-600">Who could receive a campaign from this group?</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Channel"><select className={`${input} w-32`} value={channel} onChange={(e) => { setChannel(e.target.value); setResult(null); }}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></select></Field>
        <Field label="Topic"><select className={`${input} w-44`} value={topic} onChange={(e) => { setTopic(e.target.value); setResult(null); }}><option value="general">General</option>{settings?.topics?.map((t: Row) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
        <button className={btnGhost} disabled={busy} onClick={() => act(async () => setResult(await apiRequest<Row>('/comm/segments/preview', { method: 'POST', body: { definition, channel, topic } })))}>{busy ? 'Counting…' : 'Count'}</button>
      </div>
      <Msg error={error} />
      {result && (
        <div className="mt-3">
          <p><b>{result.eligible}</b> of {result.total} can be messaged · <b>{result.excluded}</b> left out</p>
          {result.excluded > 0 && (
            <ul className="mt-1 text-xs text-slate-600">
              {Object.entries<number>(result.breakdown).map(([k, n]) => <li key={k}>{n} — {EXCLUSION_LABELS[k] ?? k}</li>)}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Counts are worked out from live consent records. A campaign checks again for every person at the moment of sending.</p>
        </div>
      )}
    </div>
  );
}

function Editor({ seg, onClose, onDone }: { seg: Row | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(seg?.name ?? '');
  const [description, setDescription] = useState(seg?.description ?? '');
  const [def, setDef] = useState<Def>(seg?.definition ?? {});
  const { act, error, busy } = useAction(onDone);
  const toggle = (k: 'kinds' | 'languages' | 'interests', v: string) =>
    setDef((d) => { const cur = d[k] ?? []; const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]; return { ...d, [k]: next.length ? next : undefined }; });
  const num = (k: 'upcomingTravelWithinDays' | 'notContactedForDays', v: string) => setDef((d) => ({ ...d, [k]: v ? Number(v) : undefined }));
  const clean = Object.fromEntries(Object.entries(def).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  return (
    <Modal title={seg ? 'Edit segment' : 'New segment'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><input className={input} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">Filter</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Marketing consent"><select className={input} value={def.subscribedChannel ?? ''} onChange={(e) => setDef((d) => ({ ...d, subscribedChannel: e.target.value || undefined, topics: e.target.value ? d.topics : undefined }))}><option value="">Anyone</option><option value="WHATSAPP">Subscribed on WhatsApp</option><option value="EMAIL">Subscribed by email</option></select></Field>
            <Field label="Tags (comma separated)"><input className={input} value={(def.tags ?? []).join(', ')} onChange={(e) => setDef((d) => ({ ...d, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }))} /></Field>
            <Field label="Travelling within (days)"><input className={input} type="number" min={1} max={730} value={def.upcomingTravelWithinDays ?? ''} onChange={(e) => num('upcomingTravelWithinDays', e.target.value)} /></Field>
            <Field label="Not messaged for (days)"><input className={input} type="number" min={1} max={730} value={def.notContactedForDays ?? ''} onChange={(e) => num('notContactedForDays', e.target.value)} /></Field>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-3">{KINDS.map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={def.kinds?.includes(k) ?? false} onChange={() => toggle('kinds', k)} />{k.toLowerCase()}</label>)}</div>
            <div className="flex flex-wrap gap-3">{[['en', 'English'], ['ha', 'Hausa'], ['ar', 'Arabic']].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={def.languages?.includes(k) ?? false} onChange={() => toggle('languages', k)} />{l}</label>)}</div>
            <div className="flex flex-wrap gap-3">{INTERESTS.map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={def.interests?.includes(k) ?? false} onChange={() => toggle('interests', k)} />{k.toLowerCase()}</label>)}</div>
          </div>
        </fieldset>
        <p className="text-xs text-slate-500">This group: {describe(clean as Def)}</p>
        <Preview definition={clean as Def} />
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy || name.trim().length < 2} onClick={() => act(async () => {
            if (seg) await apiRequest(`/comm/segments/${seg.id}`, { method: 'PUT', body: { name, description, definition: clean } });
            else await apiRequest('/comm/segments', { method: 'POST', body: { name, description, definition: clean } });
            onClose();
          })}>{busy ? 'Saving…' : 'Save segment'}</button>
        </div>
      </div>
    </Modal>
  );
}

function Segments() {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [refresh, setRefresh] = useState(0);
  const [counts, setCounts] = useState(false);
  const [editing, setEditing] = useState<Row | null | 'new'>(null);
  const bump = () => setRefresh((n) => n + 1);
  const { data, error, loading } = useApi<Row[]>(`/comm/segments?counts=${counts}`, refresh);
  const { act, error: actionError, busy } = useAction(bump);
  return (
    <>
      <PageTitle title="Segments" subtitle="Saved groups of contacts. A segment only chooses who is listed; consent, topic and the do-not-send list are still checked for every person when a campaign is sent." actions={
        <>
          <button className={btnGhost} onClick={() => setCounts((c) => !c)}>{counts ? 'Hide counts' : 'Show contact counts'}</button>
          {can('comm:segment:manage') && <button className={btn} onClick={() => setEditing('new')}>New segment</button>}
        </>
      } />
      <Msg error={error ?? actionError} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : data?.length === 0 ? <Empty>No segments yet.</Empty> : (
        <Table head={['Segment', 'Who', ...(counts ? ['Contacts'] : []), '']}>
          {data?.map((s) => (
            <tr key={s.id}>
              <td className={td}><p className="font-medium text-slate-900">{s.name}</p><p className="text-xs text-slate-500">{s.description}</p></td>
              <td className={td}><span className="text-xs text-slate-600">{s.kind === 'STATIC' ? 'Fixed list' : describe(s.definition)}</span></td>
              {counts && <td className={td}>{s.memberCount}</td>}
              <td className={`${td} text-right whitespace-nowrap`}>
                {can('comm:segment:manage') && s.kind === 'DYNAMIC' && <button className={btnGhost} onClick={() => setEditing(s)}>Edit</button>}{' '}
                {can('comm:segment:manage') && <button className={btnDanger} disabled={busy} onClick={() => { if (confirm(`Delete the segment “${s.name}”?`)) act(() => apiRequest(`/comm/segments/${s.id}`, { method: 'DELETE' })); }}>Delete</button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className={`${card} mt-6 text-xs text-slate-500`}>Counting contacts for every segment reads the whole contact list, so it is off until you ask for it.</div>
      {editing && <Editor seg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={bump} />}
    </>
  );
}

export default function SegmentsPage() {
  return (
    <CommPage title="Segments">
      <Segments />
    </CommPage>
  );
}
