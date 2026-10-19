'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CardBack, CardFront, CardPreviewData, CardStatus } from '@/components/staff-cards/CardFace';
import { NfcChipPanel } from '@/components/staff-cards/NfcChipPanel';
import { Empty, Field, Modal, Msg, PageTitle, Row, Table, btn, btnDanger, btnGhost, card, fmtDate, input, td, useAction, when } from '@/components/comm/ui';
import { FilePickButton } from '@/components/staff-cards/FilePickButton';
import { apiOpenPdf, apiRequest, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';
import { useApi } from '@/lib/use-api';

type ReasonAction = 'suspend' | 'reinstate' | 'revoke' | 'replace';
const ACTION_COPY: Record<ReasonAction, { title: string; help: string; button: string; danger?: boolean }> = {
  suspend: { title: 'Suspend this card', help: 'The card stops verifying as valid straight away. It can be reinstated later.', button: 'Suspend card' },
  reinstate: { title: 'Reinstate this card', help: 'The card verifies as valid again (if it has not expired).', button: 'Reinstate card' },
  revoke: { title: 'Revoke this card', help: 'The card is withdrawn permanently and cannot be brought back. Use this when someone leaves or a card is stolen.', button: 'Revoke card', danger: true },
  replace: { title: 'Replace this card', help: 'The old card stops working for good and a new one, with a new QR code, is issued to the same person.', button: 'Replace card' },
};

function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);
  const { data: c, error: loadError } = useApi<Row>(`/staff-cards/${id}`, refresh);
  const { data: preview } = useApi<CardPreviewData>(`/staff-cards/${id}/preview`, refresh);
  const { act, error, notice, busy } = useAction(bump);
  const [dialog, setDialog] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState('');
  const [renewMonths, setRenewMonths] = useState('');
  const [showRenew, setShowRenew] = useState(false);
  const [activateReplacement, setActivateReplacement] = useState(true);

  if (loadError) return <Msg error={loadError} />;
  if (!c) return <p className="text-sm text-slate-500">Loading…</p>;

  const manage = can('staff_card:manage');
  const eff: string = c.effectiveStatus;
  const mutable = !['REVOKED', 'REPLACED'].includes(eff);

  async function runDialog() {
    if (!dialog) return;
    const body = dialog === 'replace' ? { reason, activateNow: activateReplacement } : { reason };
    const result = await apiRequest<Row>(`/staff-cards/${id}/${dialog}`, { method: 'POST', body });
    setDialog(null);
    setReason('');
    // a replacement is a different card: go to it
    if (dialog === 'replace' && result?.id && result.id !== id) router.push(`/admin/staff-cards/${result.id}`);
  }

  return (
    <>
      <PageTitle
        title={c.staff.fullName}
        subtitle={`${c.cardNumber} · ${c.staff.employeeCode}${c.staff.jobTitle ? ` · ${c.staff.jobTitle}` : ''}`}
        actions={
          <>
            <Link className={btnGhost} href="/admin/staff-cards">← All cards</Link>
            {['ACTIVE', 'PENDING'].includes(eff) && <button className={btnGhost} onClick={() => act(() => apiOpenPdf(`/staff-cards/${id}/pdf`, { filename: `${c.cardNumber}.pdf` }))}>Open print-ready PDF</button>}
            {['ACTIVE', 'PENDING'].includes(eff) && manage && <button className={btn} onClick={() => act(() => apiOpenPdf('/staff-cards/print', { method: 'POST', body: { cardIds: [id], layout: 'cards' }, filename: `${c.cardNumber}.pdf` }).then(bump), 'Print recorded in the history.')}>Print card</button>}
          </>
        }
      />
      <Msg error={error} notice={notice} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className={card}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Card preview</h2>
              <button className={btnGhost} onClick={() => window.print()}>Print this page</button>
            </div>
            {preview ? (
              <div className="flex flex-wrap gap-5">
                <div><p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Front</p><CardFront c={preview} /></div>
                <div><p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Back</p><CardBack c={preview} /></div>
              </div>
            ) : <p className="text-sm text-slate-500">Loading preview…</p>}
            {preview && (
              <p className="mt-3 break-all text-[11px] text-slate-400">
                The QR code opens <span className="font-mono">{preview.verifyUrl.replace(/[A-Za-z0-9_-]{22}$/, '…')}</span> — a link that identifies this card and nothing else. It cannot sign anyone in or approve anything.
              </p>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">History</h2>
            {c.history.length === 0 ? <Empty>No history yet.</Empty> : (
              <Table head={['When', 'What happened', 'Change', 'Reason', 'By']}>
                {c.history.map((h: Row) => (
                  <tr key={h.id}>
                    <td className={td}>{when(h.createdAt)}</td>
                    <td className={td}><span className="font-medium">{h.action.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className={td}>{h.fromStatus && h.toStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus ?? '—'}</td>
                    <td className={td}>{h.reason ?? '—'}</td>
                    <td className={`${td} text-xs text-slate-500`}>{h.actorIdentityId ? 'administrator' : 'system'}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className={card}>
            <h2 className="text-sm font-semibold">Status</h2>
            <div className="mt-2 flex items-center gap-2"><CardStatus value={eff} />{c.status !== eff && <span className="text-[11px] text-slate-400">stored as {c.status}</span>}</div>
            {c.statusReason && <p className="mt-2 text-xs text-slate-600">Reason: {c.statusReason}</p>}
            <dl className="mt-3 space-y-1 text-xs text-slate-600">
              <div className="flex justify-between"><dt>Issued</dt><dd>{fmtDate(c.issuedAt)}</dd></div>
              <div className="flex justify-between"><dt>Activated</dt><dd>{fmtDate(c.activatedAt)}</dd></div>
              <div className="flex justify-between"><dt>Expires</dt><dd>{fmtDate(c.expiresAt)}{c.daysToExpiry != null && eff === 'ACTIVE' ? ` (${c.daysToExpiry} d)` : ''}</dd></div>
              <div className="flex justify-between"><dt>Printed</dt><dd>{c.printedCount}×</dd></div>
              <div className="flex justify-between"><dt>Branch</dt><dd>{c.staff.branchName ?? '—'}</dd></div>
            </dl>
            {!c.staff.isActive && <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">This staff member is deactivated, so the card no longer verifies.</p>}
            {c.replacedByCardId && <p className="mt-3 text-xs"><a className="text-amber-700 hover:underline" href={`/admin/staff-cards/${c.replacedByCardId}`}>See the replacement card →</a></p>}
          </div>

          {can('staff_card:read') && <NfcChipPanel cardId={id} effective={eff} canManage={can('staff_card:nfc')} onChange={bump} />}

          {manage && (
            <div className={card}>
              <h2 className="text-sm font-semibold">Actions</h2>
              <div className="mt-3 flex flex-col gap-2">
                {eff === 'PENDING' && <button className={btn} disabled={busy} onClick={() => act(() => apiRequest(`/staff-cards/${id}/activate`, { method: 'POST' }), 'Card activated.')}>Activate (card handed over)</button>}
                {['ACTIVE', 'EXPIRED'].includes(eff) && <button className={btn} disabled={busy} onClick={() => setShowRenew(true)}>Renew</button>}
                {eff === 'ACTIVE' && <button className={btnGhost} disabled={busy} onClick={() => setDialog('suspend')}>Suspend…</button>}
                {c.status === 'SUSPENDED' && c.staff.isActive && <button className={btnGhost} disabled={busy} onClick={() => setDialog('reinstate')}>Reinstate…</button>}
                {mutable && <button className={btnGhost} disabled={busy} onClick={() => setDialog('replace')}>Replace (lost / damaged)…</button>}
                {mutable && <button className={btnDanger} disabled={busy} onClick={() => setDialog('revoke')}>Revoke…</button>}
                {!mutable && <p className="text-xs text-slate-500">This card is final: it cannot be changed. The history is kept.</p>}
                <p className="text-[11px] text-slate-400">You cannot change your own card; another administrator has to.</p>
              </div>
            </div>
          )}

          {manage && (
            <div className={card}>
              <h2 className="text-sm font-semibold">Photograph</h2>
              {c.staff.hasPhoto ? <p className="mt-1 text-xs text-emerald-700">A photograph is on file and appears on the card.</p> : <p className="mt-1 text-xs text-amber-700">No photograph yet. The card shows the person&apos;s initials until one is added.</p>}
              <FilePickButton
                className={`${btnGhost} mt-3`}
                accept="image/jpeg,image/png"
                disabled={busy}
                label={c.staff.hasPhoto ? 'Choose a new photograph…' : 'Choose photograph and upload…'}
                onFile={(f) => act(async () => { await apiUpload(`/staff-cards/staff/${c.staff.id}/photo`, f); }, 'Photograph saved (resized, and camera data removed).')}
              />
              <p className="mt-2 text-[11px] text-slate-400">JPEG or PNG, up to 5 MB. It is resized to a portrait and any location or device data is removed.</p>
            </div>
          )}
        </aside>
      </div>

      {dialog && (
        <Modal title={ACTION_COPY[dialog].title} onClose={() => setDialog(null)}>
          <p className="mb-3 text-sm text-slate-600">{ACTION_COPY[dialog].help}</p>
          <Field label="Reason (recorded in the history)">
            <textarea className={input} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
          </Field>
          {dialog === 'replace' && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={activateReplacement} onChange={(e) => setActivateReplacement(e.target.checked)} /> Activate the new card straight away</label>}
          <Msg error={error} />
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setDialog(null)}>Cancel</button>
            <button className={ACTION_COPY[dialog].danger ? btnDanger : btn} disabled={reason.trim().length < 3 || busy} onClick={() => act(runDialog)}>{ACTION_COPY[dialog].button}</button>
          </div>
        </Modal>
      )}

      {showRenew && (
        <Modal title="Renew this card" onClose={() => setShowRenew(false)}>
          <p className="mb-3 text-sm text-slate-600">{eff === 'ACTIVE' ? 'The new expiry date is counted from the current one, so no days are lost.' : 'The card is expired; the new validity starts today.'}</p>
          <Field label="Validity to add (months)" hint="Leave blank for the company default."><input className={input} type="number" min={1} max={120} value={renewMonths} onChange={(e) => setRenewMonths(e.target.value)} /></Field>
          <Msg error={error} />
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setShowRenew(false)}>Cancel</button>
            <button className={btn} disabled={busy} onClick={() => act(async () => {
              await apiRequest(`/staff-cards/${id}/renew`, { method: 'POST', body: renewMonths ? { validityMonths: Number(renewMonths) } : {} });
              setShowRenew(false);
            }, 'Card renewed.')}>Renew</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function StaffCardDetailPage() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="Identification Card" navLinks={navForRoles(user?.roles ?? [])}>
        <Detail />
      </AppShell>
    </ProtectedRoute>
  );
}
