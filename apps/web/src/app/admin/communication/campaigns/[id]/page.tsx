'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CampaignBuilder } from '@/components/comm/CampaignBuilder';
import { CommPage } from '@/components/comm/CommPage';
import { EXCLUSION_LABELS } from '@/components/comm/labels';
import { Badge, Empty, Field, Modal, Msg, PageTitle, Pager, Row, Stat, Table, btn, btnDanger, btnGhost, card, input, td, useAction, when } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const SKIP_TEXT: Record<string, string> = {
  UNSUBSCRIBED: 'Unsubscribed before it was sent', SUPPRESSED: 'On the do-not-send list', NOT_SUBSCRIBED: 'No marketing consent',
  PENDING_CONFIRMATION: 'Consent not confirmed', TOPIC_NOT_SELECTED: 'Did not choose this topic', ADDRESS_INVALID: 'Address invalid',
  NO_ADDRESS: 'No address', CONTACT_NOT_ACTIVE: 'Contact merged or erased', TEST_MODE: 'Test mode: not on the test list',
};

function ReasonDialog({ title, help, label, action, onClose, onDone }: { title: string; help: string; label: string; action: (reason: string) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { act, error, busy } = useAction(onDone);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">{help}</p>
        <Field label={label}><input className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Back</button>
          <button className={btnDanger} disabled={busy || reason.trim().length < 5} onClick={() => act(async () => { await action(reason); onClose(); })}>{busy ? 'Working…' : title}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The approver states back exactly what they are approving; the server refuses if any of it has changed. */
function ApproveDialog({ c, preview, onClose, onDone }: { c: Row; preview: Row; onClose: () => void; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  const { act, error, busy } = useAction(onDone);
  const a = preview.audience;
  return (
    <Modal title="Approve this campaign" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5">
          <dt className="text-slate-500">Channel</dt><dd>{c.channel === 'EMAIL' ? 'Email' : 'WhatsApp'}</dd>
          <dt className="text-slate-500">Topic</dt><dd>{c.topic}</dd>
          <dt className="text-slate-500">Template</dt><dd>{c.template ? `${c.template.name} (${c.template.language})` : 'Written for this campaign'}</dd>
          <dt className="text-slate-500">Segment</dt><dd>{c.segment?.name}</dd>
          <dt className="text-slate-500">When</dt><dd>{c.scheduledAt ? when(c.scheduledAt) : 'As soon as it is started'}</dd>
          <dt className="text-slate-500">People who will receive it</dt><dd><b>{a?.eligible}</b> of {a?.total} (counted just now from consent records)</dd>
          <dt className="text-slate-500">Left out</dt><dd>{a?.excluded} {a?.excluded > 0 && <span className="text-xs text-slate-500">({Object.entries<number>(a.breakdown).map(([k, n]) => `${n} ${EXCLUSION_LABELS[k] ?? k}`).join('; ')})</span>}</dd>
          <dt className="text-slate-500">Delivery</dt><dd>{preview.provider.mode === 'SIMULATOR' ? <b className="text-sky-800">Simulator — nothing will actually be delivered</b> : `Live (${preview.provider.provider})`}</dd>
        </dl>
        {preview.settings.testMode && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Test mode is on: only the listed test recipients would receive anything.</p>}
        <Field label="Note (optional, kept in the audit log)"><input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /><span>I have read the message and checked who it goes to. I confirm {a?.eligible} people.</span></label>
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Back</button>
          <button className={btn} disabled={!sure || busy} onClick={() => act(async () => {
            await apiRequest(`/comm/campaigns/${c.id}/approve`, { method: 'POST', body: { note: note || undefined, confirm: { channel: c.channel, topic: c.topic, segmentId: c.segmentId, templateId: c.templateId, eligibleCount: a.eligible, scheduledAt: c.scheduledAt } } });
            onClose();
          })}>{busy ? 'Approving…' : 'Approve'}</button>
        </div>
      </div>
    </Modal>
  );
}

function TestDialog({ c, onClose }: { c: Row; onClose: () => void }) {
  const { user } = useAuth();
  const [to, setTo] = useState(c.channel === 'EMAIL' ? (user?.email ?? '') : '');
  const [result, setResult] = useState<string | null>(null);
  const { act, error, busy } = useAction(() => undefined);
  return (
    <Modal title="Send a test" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">One message with sample details, marked [TEST]. Allowed only to your own address or a test recipient set in the settings. It does not touch anyone&apos;s consent and is not part of the campaign.</p>
        <Field label={c.channel === 'EMAIL' ? 'Email address' : 'Test phone number'}><input className={input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Msg error={error} notice={result} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Close</button>
          <button className={btn} disabled={busy || !to} onClick={() => act(async () => {
            const r = await apiRequest<Row>(`/comm/campaigns/${c.id}/test`, { method: 'POST', body: { to } });
            setResult(r.sent ? (r.simulated ? 'Done — through the simulator, so it was written to the server log, not delivered.' : 'Sent.') : `Not sent: ${r.error ?? 'unknown reason'}`);
          })}>{busy ? 'Sending…' : 'Send test'}</button>
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
  const [dialog, setDialog] = useState<'edit' | 'approve' | 'reject' | 'cancel' | 'test' | null>(null);
  const [rStatus, setRStatus] = useState('');
  const [rPage, setRPage] = useState(1);
  const bump = () => setRefresh((n) => n + 1);
  const { data: c, error, loading } = useApi<Row>(`/comm/campaigns/${id}`, refresh);
  const { data: preview } = useApi<Row>(`/comm/campaigns/${id}/preview`, refresh);
  const canReport = can('comm:report:view');
  const { data: report } = useApi<Row>(canReport ? `/comm/campaigns/${id}/report` : null, refresh);
  const rq = new URLSearchParams({ page: String(rPage), pageSize: '20' });
  if (rStatus) rq.set('status', rStatus);
  const { data: recipients } = useApi<Row>(canReport && c && !['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(c.status) ? `/comm/campaigns/${id}/recipients?${rq.toString()}` : null, refresh);
  const { act, error: actionError, notice, busy } = useAction(bump);

  // While a campaign is going out, the numbers refresh on their own.
  useEffect(() => {
    if (!c || !['SENDING', 'SCHEDULED'].includes(c.status)) return;
    const t = setInterval(() => setRefresh((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [c]);

  if (error) return <Msg error={error} />;
  if (loading && !c) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!c) return null;
  const post = (path: string, body?: unknown, done?: string) => act(() => apiRequest(`/comm/campaigns/${id}/${path}`, { method: 'POST', body: body ?? {} }), done);
  const author = c.createdByIdentityId === user?.id;
  const issues: string[] = preview?.issues ?? [];
  const s = c.status as string;

  return (
    <>
      <PageTitle
        title={c.name}
        subtitle={`${c.channel === 'EMAIL' ? 'Email' : 'WhatsApp'} campaign · topic: ${c.topic}${c.description ? ` · ${c.description}` : ''}`}
        actions={<Link className={btnGhost} href={`/admin/communication/${c.channel === 'EMAIL' ? 'email' : 'whatsapp'}`}>← Campaigns</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge value={s} />
        {c.simulated && <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">simulated — nothing was delivered</span>}
        {preview?.provider?.mode === 'SIMULATOR' && !c.simulated && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED'].includes(s) && <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">will go through the simulator</span>}
        {preview?.settings?.killSwitch && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">kill switch is ON</span>}
        {report?.outcome?.needsReview > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{report.outcome.needsReview} need review</span>}
      </div>
      <Msg error={actionError} notice={notice} />
      {c.rejectedReason && s === 'DRAFT' && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Sent back by the reviewer: {c.rejectedReason}</p>}

      <div className="mb-6 flex flex-wrap gap-2">
        {s === 'DRAFT' && can('comm:campaign:create') && <button className={btn} onClick={() => setDialog('edit')}>Edit</button>}
        {c.status !== 'CANCELLED' && can('comm:campaign:create') && <button className={btnGhost} onClick={() => setDialog('test')} disabled={issues.some((i) => !i.startsWith('Choose who'))}>Send a test</button>}
        {s === 'DRAFT' && can('comm:campaign:create') && <button className={btn} disabled={busy || issues.length > 0} title={issues.join(' ')} onClick={() => post('submit', undefined, 'Submitted for approval.')}>Submit for approval</button>}
        {s === 'DRAFT' && can('comm:campaign:create') && <button className={btnDanger} disabled={busy} onClick={() => { if (confirm('Delete this draft?')) act(async () => { await apiRequest(`/comm/campaigns/${id}`, { method: 'DELETE' }); router.push(`/admin/communication/${c.channel === 'EMAIL' ? 'email' : 'whatsapp'}`); }); }}>Delete</button>}
        {s === 'PENDING_APPROVAL' && can('comm:campaign:approve') && !author && preview && <button className={btn} onClick={() => setDialog('approve')}>Review and approve…</button>}
        {s === 'PENDING_APPROVAL' && can('comm:campaign:approve') && !author && <button className={btnGhost} onClick={() => setDialog('reject')}>Send back…</button>}
        {s === 'PENDING_APPROVAL' && can('comm:campaign:approve') && author && <span className="self-center text-xs text-slate-500">You wrote this campaign, so a colleague has to approve it.</span>}
        {['PENDING_APPROVAL', 'APPROVED'].includes(s) && can('comm:campaign:create') && <button className={btnGhost} disabled={busy} onClick={() => post('withdraw', undefined, 'Taken back to draft.')}>Take back to draft</button>}
        {s === 'APPROVED' && can('comm:campaign:send') && <button className={btn} disabled={busy || preview?.settings?.killSwitch} onClick={() => post('start', undefined, c.scheduledAt ? 'Scheduled.' : 'Started.')}>{c.scheduledAt ? `Schedule for ${when(c.scheduledAt)}` : 'Start sending'}</button>}
        {['SENDING', 'SCHEDULED'].includes(s) && can('comm:campaign:send') && <button className={btnGhost} disabled={busy} onClick={() => post('pause', undefined, 'Paused.')}>Pause</button>}
        {s === 'PAUSED' && can('comm:campaign:send') && <button className={btn} disabled={busy || preview?.settings?.killSwitch} onClick={() => post('resume', undefined, 'Resumed.')}>Resume</button>}
        {['SCHEDULED', 'SENDING', 'PAUSED', 'APPROVED', 'PENDING_APPROVAL'].includes(s) && can('comm:campaign:send') && <button className={btnDanger} onClick={() => setDialog('cancel')}>Cancel campaign…</button>}
      </div>

      {issues.length > 0 && s === 'DRAFT' && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Before this can be submitted:</p>
          <ul className="mt-1 list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-2 text-sm font-semibold">The message {preview?.sample && <span className="font-normal text-slate-400">(with sample details)</span>}</h2>
          {!preview ? <p className="text-sm text-slate-500">Loading…</p> : preview.message.html ? (
            <>
              <p className="mb-2 text-xs text-slate-500">Subject: <b>{preview.message.subject}</b></p>
              {/* sandboxed: no scripts, no navigation, no cookies */}
              <iframe title="Email preview" sandbox="" srcDoc={preview.message.html} className="h-80 w-full rounded border border-slate-200 bg-white" />
            </>
          ) : (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">{preview.message.text}
              <p className="mt-2 text-[11px] text-slate-400">Template: {preview.message.templateName} ({preview.message.language})</p>
            </div>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-2 text-sm font-semibold">Who receives it</h2>
          {c.segment ? <p className="text-sm text-slate-600">Segment: <b>{c.segment.name}</b></p> : <p className="text-sm text-slate-500">No segment chosen yet.</p>}
          {preview?.audience && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="In the segment" value={preview.audience.total} />
                <Stat label="Can receive it" value={preview.audience.eligible} />
                <Stat label="Left out" value={preview.audience.excluded} />
              </div>
              {preview.audience.excluded > 0 && <ul className="mt-3 text-xs text-slate-600">{Object.entries<number>(preview.audience.breakdown).map(([k, n]) => <li key={k}>{n} — {EXCLUSION_LABELS[k] ?? k}</li>)}</ul>}
              <p className="mt-3 text-[11px] text-slate-400">Worked out from live consent records. {c.audienceFrozenAt ? `The list was fixed when sending started (${when(c.audienceFrozenAt)}); each person is still checked again just before their message goes.` : 'It is fixed when sending starts, and each person is checked again just before their message goes.'}</p>
            </>
          )}
          <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-xs text-slate-600">
            <dt>Written by</dt><dd>{author ? 'you' : 'a colleague'}</dd>
            {c.approvedAt && (<><dt>Approved</dt><dd>{when(c.approvedAt)}{c.approvalNote ? ` — ${c.approvalNote}` : ''}</dd></>)}
            {c.startedAt && (<><dt>Started</dt><dd>{when(c.startedAt)}</dd></>)}
            {c.completedAt && (<><dt>Finished</dt><dd>{when(c.completedAt)}</dd></>)}
            {c.cancelReason && (<><dt>Cancelled</dt><dd>{c.cancelReason}</dd></>)}
            <dt>Time zone</dt><dd>{c.timezone}</dd>
          </dl>
        </section>
      </div>

      {report && !['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(s) && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Results</h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Waiting" value={report.queue.queued + report.queue.sending} />
            <Stat label="Accepted by provider" value={report.outcome.accepted} hint={report.campaign.simulated ? 'simulator' : undefined} />
            <Stat label="Delivered" value={report.outcome.delivered} hint="as the provider reported" />
            {report.providerReports.read && <Stat label="Read" value={report.outcome.read} hint="only if the person allows read receipts" />}
            <Stat label="Failed" value={report.outcome.failed} />
            <Stat label="Skipped at send" value={report.outcome.skippedAtSend} hint="no longer eligible" />
            <Stat label="Need review" value={report.outcome.needsReview} hint="outcome unknown — never resent automatically" />
            {report.campaign.channel === 'EMAIL' && <Stat label="Bounced" value={report.outcome.bounced} />}
            {report.campaign.channel === 'EMAIL' && <Stat label="Spam complaints" value={report.outcome.complained} />}
            {report.providerReports.clicked && <Stat label="Clicks" value={report.outcome.clicked} hint="only if the provider reports them" />}
          </div>
          <p className="mt-2 text-xs text-slate-500">{report.note}</p>
          {(report.skipReasons.length > 0 || report.failureReasons.length > 0) && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 text-xs text-slate-600">
              {report.skipReasons.length > 0 && <div><p className="font-medium">Why people were skipped</p><ul>{report.skipReasons.map((r: Row) => <li key={r.reason}>{r.count} — {SKIP_TEXT[r.reason] ?? r.reason}</li>)}</ul></div>}
              {report.failureReasons.length > 0 && <div><p className="font-medium">Why messages failed</p><ul>{report.failureReasons.map((r: Row) => <li key={r.reason}>{r.count} — {r.reason}</li>)}</ul></div>}
            </div>
          )}
        </section>
      )}

      {recipients && (
        <section className="mt-6">
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-sm font-semibold">People</h2>
            <Field label="Show"><select className={`${input} w-44`} value={rStatus} onChange={(e) => { setRStatus(e.target.value); setRPage(1); }}>{['', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'UNCERTAIN', 'CANCELLED'].map((x) => <option key={x} value={x}>{x ? x.toLowerCase() : 'Everyone'}</option>)}</select></Field>
          </div>
          {recipients.items.length === 0 ? <Empty>Nobody in this view.</Empty> : (
            <>
              <Table head={['Person', 'Status', 'Detail', 'When']}>
                {recipients.items.map((r: Row) => (
                  <tr key={r.id}>
                    <td className={td}><Link className="font-medium text-amber-700 hover:underline" href={`/admin/communication/contacts/${r.contact.id}`}>{r.contact.fullName}</Link></td>
                    <td className={td}><Badge value={r.status} /></td>
                    <td className={td}><span className="text-xs text-slate-500">{r.skipReason ? (SKIP_TEXT[r.skipReason] ?? r.skipReason) : r.lastError ?? ''}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}</span></td>
                    <td className={td}>{r.readAt ? when(r.readAt) : r.deliveredAt ? when(r.deliveredAt) : r.sentAt ? when(r.sentAt) : r.failedAt ? when(r.failedAt) : '—'}</td>
                  </tr>
                ))}
              </Table>
              <Pager page={rPage} pageSize={20} total={recipients.total} onPage={setRPage} />
            </>
          )}
        </section>
      )}

      {dialog === 'edit' && <CampaignBuilder channel={c.channel} campaign={c} onClose={() => setDialog(null)} onDone={() => { setDialog(null); bump(); }} />}
      {dialog === 'approve' && preview && <ApproveDialog c={c} preview={preview} onClose={() => setDialog(null)} onDone={bump} />}
      {dialog === 'reject' && <ReasonDialog title="Send back" help="The author will see your reason and can change the campaign and submit it again." label="What needs to change?" action={(reason) => apiRequest(`/comm/campaigns/${id}/reject`, { method: 'POST', body: { reason } })} onClose={() => setDialog(null)} onDone={bump} />}
      {dialog === 'cancel' && <ReasonDialog title="Cancel campaign" help="Messages that have not gone out yet are cancelled. Messages already sent stay on record. This cannot be undone." label="Why is it being cancelled?" action={(reason) => apiRequest(`/comm/campaigns/${id}/cancel`, { method: 'POST', body: { reason } })} onClose={() => setDialog(null)} onDone={bump} />}
      {dialog === 'test' && <TestDialog c={c} onClose={() => setDialog(null)} />}
    </>
  );
}

export default function CampaignDetailPage() {
  return (
    <CommPage title="Campaign">
      <Detail />
    </CommPage>
  );
}
