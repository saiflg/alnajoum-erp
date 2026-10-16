'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Badge, Empty, Field, Modal, Msg, PageTitle, Row, Table, Tabs, btn, btnGhost, card, input, td, useAction, when } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';
import { useApi } from '@/lib/use-api';

type Tab = 'readers' | 'profiles' | 'batches' | 'guide';
const ADAPTERS: [string, string][] = [
  ['WEB_NFC', 'Phone browser (Web NFC)'],
  ['KEYBOARD_WEDGE', 'USB reader that types'],
  ['PCSC_BRIDGE', 'PC/SC reader through the local bridge'],
  ['VENDOR_SDK', 'Reader maker SDK through the bridge'],
  ['ANDROID_APP', 'Android companion app (not built yet)'],
  ['MOCK', 'MOCK reader (tests only)'],
];

function ProfileDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: caps } = useApi<Row[]>('/nfc/capabilities');
  const [f, setF] = useState({ name: '', chipType: 'NTAG213', cardStock: '', readerModel: '', compatibilityNotes: '', isDefault: false });
  const { act, error, busy } = useAction(onDone);
  const cap = caps?.find((c) => c.chipType === f.chipType);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Record a card and chip type" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. White PVC with NTAG213" /></Field>
          <Field label="Chip"><select className={input} value={f.chipType} onChange={(e) => set('chipType', e.target.value)}>{caps?.map((c) => <option key={c.chipType} value={c.chipType}>{c.label}</option>)}</select></Field>
          <Field label="PVC card stock and supplier"><input className={input} value={f.cardStock} onChange={(e) => set('cardStock', e.target.value)} /></Field>
          <Field label="Reader model"><input className={input} value={f.readerModel} onChange={(e) => set('readerModel', e.target.value)} /></Field>
        </div>
        {cap && (
          <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
            <p><b>What this chip can do:</b> {cap.ndef ? 'carries a plain NDEF address that a phone can read' : 'not suited to a plain NDEF address'}{cap.userMemoryBytes ? `; about ${cap.userMemoryBytes} bytes of memory` : ''}.</p>
            <p className="mt-1"><b>What this system does with it:</b> stores a random reference and checks it on the server. It does <b>not</b> use the chip&apos;s cryptographic features.</p>
            {cap.warning && <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">{cap.warning}</p>}
          </div>
        )}
        <Field label="Compatibility check notes" hint="Record what you actually tested: card + chip + reader + phone model/OS + software. Do not tick things you have not tried."><textarea className={input} rows={3} value={f.compatibilityNotes} onChange={(e) => set('compatibilityNotes', e.target.value)} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Use as the default for new cards</label>
        <Msg error={error} />
        <div className="flex justify-end gap-2"><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btn} disabled={busy || f.name.trim().length < 2} onClick={() => act(async () => { await apiRequest('/nfc/profiles', { method: 'POST', body: { ...f, cardStock: f.cardStock || undefined, readerModel: f.readerModel || undefined, compatibilityNotes: f.compatibilityNotes || undefined } }); onClose(); })}>Save</button></div>
      </div>
    </Modal>
  );
}

function ReaderDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', model: '', adapter: 'WEB_NFC', location: '' });
  const [secret, setSecret] = useState<string | null>(null);
  const { act, error, busy } = useAction(onDone);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Register a reader" onClose={onClose}>
      {secret ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold">Copy this secret into the bridge program now.</p>
          <p className="rounded-md bg-slate-900 p-3 font-mono text-xs break-all text-white">{secret}</p>
          <p className="text-xs text-slate-500">It is shown only once and stored only as a one-way hash. With it, the bridge can report the reader&apos;s status and have cards checked — nothing else. If it is lost, register the reader again.</p>
          <div className="flex justify-end"><button className={btn} onClick={onClose}>I have copied it</button></div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <Field label="Name"><input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Front desk reader" /></Field>
          <Field label="Type"><select className={input} value={f.adapter} onChange={(e) => set('adapter', e.target.value)}>{ADAPTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Model"><input className={input} value={f.model} onChange={(e) => set('model', e.target.value)} /></Field><Field label="Location"><input className={input} value={f.location} onChange={(e) => set('location', e.target.value)} /></Field></div>
          {f.adapter === 'MOCK' && <p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs font-semibold text-sky-900">A MOCK reader reads no real card. Its results are marked SIMULATED everywhere.</p>}
          <Msg error={error} />
          <div className="flex justify-end gap-2"><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btn} disabled={busy || f.name.trim().length < 2} onClick={() => act(async () => {
            const r = await apiRequest<Row>('/nfc/readers', { method: 'POST', body: { name: f.name, adapter: f.adapter, model: f.model || undefined, location: f.location || undefined } });
            if (r.bridgeToken) setSecret(r.bridgeToken); else onClose();
          })}>Register</button></div>
        </div>
      )}
    </Modal>
  );
}

function NfcSettings() {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [tab, setTab] = useState<Tab>('readers');
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<'profile' | 'reader' | null>(null);
  const bump = () => setRefresh((n) => n + 1);
  const { data: ov, error } = useApi<Row>('/nfc/overview', refresh);
  const { data: batches } = useApi<Row[]>(tab === 'batches' ? '/nfc/batches' : null, refresh);
  const { act, error: actionError, busy } = useAction(bump);
  const manage = can('staff_card:nfc');

  return (
    <>
      <PageTitle title="NFC & Readers" subtitle="Which chips and readers the company uses, the state of each reader, and the cards written so far. A tap is always checked against our records; the chip never decides." actions={
        <>
          <Link className={btnGhost} href="/admin/staff-cards/scanner">Open scanner</Link>
          {manage && tab === 'profiles' && <button className={btn} onClick={() => setDialog('profile')}>Add chip type</button>}
          {manage && tab === 'readers' && <button className={btn} onClick={() => setDialog('reader')}>Register a reader</button>}
        </>
      } />
      <Msg error={error ?? actionError} />
      {ov && (
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          {(['PREPARED', 'ENCODED', 'VERIFIED', 'FAILED'] as const).map((k) => <div key={k} className={card}><p className="text-xs text-slate-500">Chips {k.toLowerCase() === 'verified' ? 'confirmed' : k.toLowerCase()}</p><p className="mt-1 text-2xl font-semibold">{ov.chips[k] ?? 0}</p></div>)}
        </div>
      )}
      <Tabs tabs={[['readers', 'Readers'], ['profiles', 'Chip types'], ['batches', 'Batches'], ['guide', 'Hardware guide']]} value={tab} onChange={setTab} />

      {tab === 'readers' && ov && (
        ov.readers.length === 0 ? <Empty>No reader registered yet. The scanner can still use this phone or a test reader without registering one.</Empty> : (
          <Table head={['Reader', 'Type', 'Status', 'Last card', 'Last result', 'Compatibility', '']}>
            {ov.readers.map((r: Row) => (
              <tr key={r.id}>
                <td className={td}><p className="font-medium">{r.name}</p><p className="text-xs text-slate-500">{[r.model, r.location].filter(Boolean).join(' · ')}</p></td>
                <td className={td}>{r.adapter.replace(/_/g, ' ').toLowerCase()}{r.simulated && <p><span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">MOCK</span></p>}</td>
                <td className={td}><Badge value={r.isActive ? r.status : 'DISABLED'} />{r.lastError && <p className="mt-1 max-w-xs text-xs text-red-700">{r.lastError}</p>}<p className="text-[11px] text-slate-400">{r.lastSeenAt ? `seen ${when(r.lastSeenAt)}` : 'never connected'}</p></td>
                <td className={td}>{r.lastCardAt ? when(r.lastCardAt) : '—'}</td>
                <td className={td}>{r.lastResult ?? '—'}</td>
                <td className={td}><span className="text-xs text-slate-500">{r.compatibility}</span></td>
                <td className={`${td} text-right`}>{manage && <button className={btnGhost} disabled={busy} onClick={() => act(() => apiRequest(`/nfc/readers/${r.id}/active`, { method: 'PUT', body: { isActive: !r.isActive } }))}>{r.isActive ? 'Switch off' : 'Switch on'}</button>}</td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === 'profiles' && ov && (
        ov.profiles.length === 0 ? <Empty>No chip type recorded. Record the card and chip you bought before issuing NFC cards.</Empty> : (
          <Table head={['Name', 'Chip', 'Card stock', 'Reader', 'Used', 'Notes']}>
            {ov.profiles.map((p: Row) => (
              <tr key={p.id}>
                <td className={td}><p className="font-medium">{p.name}</p>{p.isDefault && <Badge value="ACTIVE" />}</td>
                <td className={td}>{p.capability.label}<p className="text-[11px] text-slate-400">{p.frequency}</p></td>
                <td className={td}>{p.cardStock ?? '—'}</td>
                <td className={td}>{p.readerModel ?? '—'}</td>
                <td className={td}>{p._count.credentials}</td>
                <td className={td}><span className="text-xs text-slate-500">{p.compatibilityNotes ?? p.capability.warning ?? ''}</span></td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === 'batches' && (!batches ? <p className="text-sm text-slate-500">Loading…</p> : batches.length === 0 ? <Empty>No chips prepared yet.</Empty> : (
        <Table head={['Batch', 'Prepared', 'Written', 'Confirmed', 'Failed']}>
          {batches.map((b) => <tr key={b.batch}><td className={td}>{b.batch}</td><td className={td}>{b.PREPARED ?? 0}</td><td className={td}>{b.ENCODED ?? 0}</td><td className={td}>{b.VERIFIED ?? 0}</td><td className={td}>{b.FAILED ?? 0}</td></tr>)}
        </Table>
      ))}

      {tab === 'guide' && (
        <div className={`${card} space-y-3 text-sm text-slate-700`}>
          <h2 className="font-semibold">What works with what</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>13.56 MHz ISO/IEC 14443 cards.</b> Start with NTAG213/215 for simple tap-to-open cards. They are cheap and phones read them, but they can be copied. DESFire EV2/EV3 and NTAG 424 DNA can be protected with keys; this system does not use those protections yet.</li>
            <li><b>A phone (Android + Chrome, HTTPS).</b> Can read and write cards with no extra equipment. iPhones and desktop browsers cannot use Web NFC.</li>
            <li><b>A USB reader on a computer.</b> Most are PC/SC devices. A browser cannot talk to them directly: they need their driver and the local bridge program, which posts taps to the server with the reader&apos;s secret. Some readers can be set to type what they read; those work with the &ldquo;USB reader that types&rdquo; option.</li>
            <li><b>Not yet tested on real hardware.</b> Everything here was exercised with a labelled test reader. Try one real card and reader end to end before ordering a batch.</li>
          </ul>
          <h2 className="pt-2 font-semibold">Before you order cards</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Choose the chip, then the PVC card stock that carries it, then the reader.</li>
            <li>Order a few samples. Write one, tap it with the phone, and with the reader you plan to use.</li>
            <li>Record the result in the chip type&apos;s notes. Only then order the batch.</li>
          </ol>
        </div>
      )}

      {dialog === 'profile' && <ProfileDialog onClose={() => setDialog(null)} onDone={bump} />}
      {dialog === 'reader' && <ReaderDialog onClose={() => setDialog(null)} onDone={bump} />}
    </>
  );
}

export default function NfcSettingsPage() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="NFC & Readers" navLinks={navForRoles(user?.roles ?? [])}>
        <NfcSettings />
      </AppShell>
    </ProtectedRoute>
  );
}
