'use client';

import { useState } from 'react';
import { CommPage } from '@/components/comm/CommPage';
import { Badge, Empty, Field, Modal, Msg, PageTitle, Pager, Row, Table, btn, btnGhost, card, input, td, useAction, when } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const PAGE_SIZE = 25;
const REASON_TEXT: Record<string, string> = {
  UNSUBSCRIBED: 'Unsubscribed by the person',
  BOUNCED: 'Email bounced',
  COMPLAINT: 'Reported as spam',
  INVALID_ADDRESS: 'Address invalid',
  ADMIN: 'Blocked by an administrator',
};

function BlockDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState('EMAIL');
  const [value, setValue] = useState('');
  const { act, error, busy } = useAction(onDone);
  return (
    <Modal title="Block an address" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">A blocked address will not be sent marketing or service messages, and cannot be subscribed again until you lift the block.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Channel"><select className={input} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option></select></Field>
          <div className="col-span-2"><Field label={channel === 'EMAIL' ? 'Email address' : 'Phone number'}><input className={input} value={value} onChange={(e) => setValue(e.target.value)} /></Field></div>
        </div>
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy || value.trim().length < 5} onClick={() => act(async () => { await apiRequest('/comm/suppressions', { method: 'POST', body: { channel, value } }); onClose(); })}>Block</button>
        </div>
      </div>
    </Modal>
  );
}

function LiftDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { act, error, busy } = useAction(onDone);
  return (
    <Modal title="Remove from the list" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>{row.valueHint} ({row.channel.toLowerCase()}) — {REASON_TEXT[row.reason] ?? row.reason}</p>
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Removing an entry does not subscribe anyone. The person still has to give marketing consent themselves.</p>
        <Field label="Why is it being removed? (kept in the audit log)"><input className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy || reason.trim().length < 8} onClick={() => act(async () => { await apiRequest(`/comm/suppressions/${row.id}/lift`, { method: 'POST', body: { reason } }); onClose(); })}>Remove</button>
        </div>
      </div>
    </Modal>
  );
}

function Suppression() {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [channel, setChannel] = useState('');
  const [reason, setReason] = useState('');
  const [lifted, setLifted] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<'block' | Row | null>(null);
  const bump = () => setRefresh((n) => n + 1);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (channel) qs.set('channel', channel);
  if (reason) qs.set('reason', reason);
  if (lifted) qs.set('includeLifted', 'true');
  const { data, error, loading } = useApi<Row>(`/comm/suppressions?${qs.toString()}`, refresh);
  return (
    <>
      <PageTitle title="Unsubscribe / Suppression list" subtitle="Addresses we must not market to. Kept as one-way fingerprints, so deleting a contact or importing the same address again cannot bring it back. Only a new consent from the person lifts an unsubscribe." actions={can('comm:suppression:manage') ? <button className={btn} onClick={() => setDialog('block')}>Block an address</button> : undefined} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Channel"><select className={`${input} w-36`} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></select></Field>
        <Field label="Reason"><select className={`${input} w-56`} value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }}><option value="">All</option>{Object.entries(REASON_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={lifted} onChange={(e) => { setLifted(e.target.checked); setPage(1); }} /> Include removed entries</label>
      </div>
      <Msg error={error} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : data?.items.length === 0 ? <Empty>Nothing on the list.</Empty> : (
        <>
          <Table head={['Address', 'Channel', 'Why', 'Source', 'Since', 'Status', '']}>
            {data?.items.map((r: Row) => (
              <tr key={r.id}>
                <td className={td}>{r.valueHint}</td>
                <td className={td}>{r.channel.toLowerCase()}</td>
                <td className={td}>{REASON_TEXT[r.reason] ?? r.reason}</td>
                <td className={td}><span className="text-xs text-slate-500">{r.source.toLowerCase().replace(/_/g, ' ')}</span></td>
                <td className={td}>{when(r.createdAt)}</td>
                <td className={td}>{r.liftedAt ? <><Badge value="REMOVED" /><p className="text-[11px] text-slate-400">{r.liftedReason}</p></> : <Badge value="ACTIVE" />}</td>
                <td className={`${td} text-right`}>{!r.liftedAt && r.reason !== 'UNSUBSCRIBED' && r.reason !== 'COMPLAINT' && can('comm:suppression:manage') && <button className={btnGhost} onClick={() => setDialog(r)}>Remove…</button>}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
      <div className={`${card} mt-6 text-xs text-slate-500`}>A person who unsubscribed can only be marketed to again after they subscribe themselves (the sign-up page, the preferences page or a WhatsApp START). Spam complaints can never be removed from here.</div>
      {dialog === 'block' && <BlockDialog onClose={() => setDialog(null)} onDone={bump} />}
      {dialog && dialog !== 'block' && <LiftDialog row={dialog} onClose={() => setDialog(null)} onDone={bump} />}
    </>
  );
}

export default function SuppressionPage() {
  return (
    <CommPage title="Suppression list">
      <Suppression />
    </CommPage>
  );
}
