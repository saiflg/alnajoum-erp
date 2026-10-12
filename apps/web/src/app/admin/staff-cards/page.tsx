'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CardStatus } from '@/components/staff-cards/CardFace';
import { Empty, Field, Modal, Msg, PageTitle, Pager, Row, Stat, Table, btn, btnGhost, card, fmtDate, input, td, useAction } from '@/components/comm/ui';
import { apiOpenPdf, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';
import { useApi } from '@/lib/use-api';

const STATUSES = ['', 'PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REPLACED'];
const PAGE_SIZE = 20;

function IssueDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [staffId, setStaffId] = useState('');
  const [activateNow, setActivateNow] = useState(false);
  const [months, setMonths] = useState('');
  const { data: candidates, loading } = useApi<Row[]>(`/staff-cards/staff-without-card?search=${encodeURIComponent(search)}`);
  const { act, error, busy } = useAction(onDone);

  return (
    <Modal title="Issue an identification card" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Find a staff member without a card" hint="Only active staff who do not already hold a current card are listed.">
          <input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or staff ID" />
        </Field>
        <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200">
          {loading && <p className="p-3 text-sm text-slate-500">Loading…</p>}
          {candidates?.length === 0 && <p className="p-3 text-sm text-slate-500">No staff member without a card matches.</p>}
          {candidates?.map((s) => (
            <label key={s.id} className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 ${staffId === s.id ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
              <input type="radio" name="staff" checked={staffId === s.id} onChange={() => setStaffId(s.id)} />
              <span className="flex-1">
                <span className="font-medium">{s.firstName} {s.lastName}</span>
                <span className="ml-2 text-xs text-slate-500">{s.employeeCode} · {s.jobTitle ?? s.department ?? 'Staff'}{s.branch ? ` · ${s.branch.name}` : ''}</span>
              </span>
              {!s.photoFilename && <span className="text-[11px] text-amber-700">no photo yet</span>}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Validity (months)" hint="Leave blank to use the company default.">
            <input className={input} type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activateNow} onChange={(e) => setActivateNow(e.target.checked)} />
            Activate immediately
          </label>
        </div>
        <p className="text-xs text-slate-500">Without “activate immediately” the card is PENDING: it can be printed, but scanning it will not vouch for anyone until it is activated when handed over.</p>
        <Msg error={error} />
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button
            className={btn}
            disabled={!staffId || busy}
            onClick={() => act(async () => {
              await apiRequest('/staff-cards', { method: 'POST', body: { staffId, activateNow, ...(months ? { validityMonths: Number(months) } : {}) } });
              onClose();
            })}
          >
            {busy ? 'Issuing…' : 'Issue card'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CardsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const can = (p: string) => !!user?.permissions.includes(p);

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [expiring, setExpiring] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const bump = () => { setRefresh((n) => n + 1); setSelected([]); };
  const { act, error, notice, busy } = useAction(() => undefined);

  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) qs.set('status', status);
  if (search.trim()) qs.set('search', search.trim());
  if (expiring) qs.set('expiringWithinDays', '30');

  const { data: dash } = useApi<Row>('/staff-cards/dashboard', refresh);
  const { data: list, error: listError, loading } = useApi<Row>(`/staff-cards?${qs.toString()}`, refresh);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const printable = (list?.items ?? []).filter((c: Row) => ['ACTIVE', 'PENDING'].includes(c.effectiveStatus));

  return (
    <>
      <PageTitle
        title="Identification Cards"
        subtitle="Issue, renew, suspend, revoke and replace staff identification cards. Scanning a card's QR code always asks this system for the card's current status."
        actions={
          <>
            <button className={btnGhost} onClick={() => router.push('/admin/staff-cards/scanner')}>Open scanner</button>
            {can('staff_card:settings') && <button className={btnGhost} onClick={() => router.push('/admin/staff-cards/settings')}>Card design</button>}
            {can('staff_card:manage') && <button className={btn} onClick={() => setIssuing(true)}>Issue a card</button>}
          </>
        }
      />

      {dash && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total cards" value={dash.total} hint={`${dash.pending} awaiting activation`} />
          <Stat label="Active" value={dash.active} />
          <Stat label="Expiring soon" value={dash.expiringSoon} hint={`within ${dash.expiringSoonWindowDays} days`} />
          <Stat label="Expired" value={dash.expired} />
          <Stat label="Suspended" value={dash.suspended} />
          <Stat label="Revoked" value={dash.revoked} />
          <Stat label="Replaced" value={dash.replaced} hint="older cards, kept for the record" />
          <Stat label="Scans in 24 h" value={Object.values<number>(dash.scansLast24h ?? {}).reduce((a, b) => a + b, 0)} hint={Object.entries<number>(dash.scansLast24h ?? {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'none yet'} />
        </div>
      )}

      {dash?.recentlyIssued?.length > 0 && (
        <div className={`${card} mb-6`}>
          <h2 className="text-sm font-semibold">Recently issued</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {dash.recentlyIssued.slice(0, 5).map((c: Row) => (
              <li key={c.id} className="flex items-center justify-between py-1.5">
                <a className="font-medium text-amber-700 hover:underline" href={`/admin/staff-cards/${c.id}`}>{c.staff.fullName}</a>
                <span className="text-xs text-slate-500">{c.cardNumber} · {fmtDate(c.createdAt)}</span>
                <CardStatus value={c.effectiveStatus} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Search"><input className={`${input} w-64`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, staff ID or card number" /></Field>
        <Field label="Status">
          <select className={`${input} w-40`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </Field>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={expiring} onChange={(e) => { setExpiring(e.target.checked); setPage(1); }} /> Expiring within 30 days</label>
        {can('staff_card:manage') && (
          <div className="mb-1 ml-auto flex gap-2">
            <button className={btnGhost} disabled={!selected.length || busy} onClick={() => act(() => apiOpenPdf('/staff-cards/print', { method: 'POST', body: { cardIds: selected, layout: 'cards' }, filename: 'staff-cards.pdf' }).then(() => setRefresh((n) => n + 1)))}>
              Print selected ({selected.length}) — card size
            </button>
            <button className={btnGhost} disabled={!selected.length || busy} onClick={() => act(() => apiOpenPdf('/staff-cards/print', { method: 'POST', body: { cardIds: selected, layout: 'sheet' }, filename: 'staff-cards-sheet.pdf' }).then(() => setRefresh((n) => n + 1)))}>
              A4 sheet
            </button>
          </div>
        )}
      </div>
      <Msg error={error ?? listError} notice={notice} />

      {loading && !list ? <p className="text-sm text-slate-500">Loading…</p> : list?.items.length === 0 ? (
        <Empty>No cards match. {can('staff_card:manage') ? 'Use “Issue a card” to create the first one.' : ''}</Empty>
      ) : (
        <>
          <Table head={['Select', 'Staff member', 'Card', 'Status', 'Issued', 'Expires', 'Open']}>
            {list?.items.map((c: Row) => (
              <tr key={c.id}>
                <td className={td}>
                  {can('staff_card:manage') && printable.some((p: Row) => p.id === c.id) && <input type="checkbox" aria-label={`Select ${c.staff.fullName}`} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />}
                </td>
                <td className={td}>
                  <p className="font-medium text-slate-900">{c.staff.fullName}</p>
                  <p className="text-xs text-slate-500">{c.staff.employeeCode} · {c.staff.jobTitle ?? c.staff.department ?? 'Staff'}{c.staff.branchName ? ` · ${c.staff.branchName}` : ''}{!c.staff.isActive ? ' · DEACTIVATED' : ''}</p>
                </td>
                <td className={td}>{c.cardNumber}</td>
                <td className={td}>
                  <CardStatus value={c.effectiveStatus} />
                  {c.status !== c.effectiveStatus && <p className="text-[10px] text-slate-400">stored: {c.status}</p>}
                </td>
                <td className={td}>{fmtDate(c.issuedAt)}</td>
                <td className={td}>
                  {fmtDate(c.expiresAt)}
                  {c.effectiveStatus === 'ACTIVE' && c.daysToExpiry != null && c.daysToExpiry <= 30 && <p className="text-[11px] text-orange-700">in {c.daysToExpiry} day(s)</p>}
                </td>
                <td className={`${td} text-right`}><a className="text-xs font-medium text-amber-700 hover:underline" href={`/admin/staff-cards/${c.id}`}>Open</a></td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={list?.total ?? 0} onPage={setPage} />
        </>
      )}

      {issuing && <IssueDialog onClose={() => setIssuing(false)} onDone={bump} />}
    </>
  );
}

export default function StaffCardsPage() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="Identification Cards" navLinks={navForRoles(user?.roles ?? [])}>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <CardsPage />
        </Suspense>
      </AppShell>
    </ProtectedRoute>
  );
}
