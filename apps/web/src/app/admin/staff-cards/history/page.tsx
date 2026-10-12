'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Empty, Field, Msg, PageTitle, Pager, Row, Table, card, input, td, when } from '@/components/comm/ui';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';
import { useApi } from '@/lib/use-api';

const RESULTS = ['', 'VALID', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REPLACED', 'INVALID'];
const TONE: Record<string, string> = {
  VALID: 'bg-emerald-100 text-emerald-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
  SUSPENDED: 'bg-yellow-100 text-yellow-900',
  REVOKED: 'bg-red-100 text-red-800',
  REPLACED: 'bg-slate-200 text-slate-700',
  INVALID: 'bg-red-100 text-red-800',
};
const PAGE_SIZE = 25;

function History() {
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (result) qs.set('result', result);
  const { data, error, loading } = useApi<Row>(`/staff-cards/scans?${qs.toString()}`);

  return (
    <>
      <PageTitle title="Card Verification History" subtitle="Every time a card was checked, by QR code, link, or typed reference — including codes the system did not recognise. Client addresses are kept only as a one-way fingerprint." />
      <div className={`${card} mb-4 flex flex-wrap items-end gap-3`}>
        <Field label="Result">
          <select className={`${input} w-44`} value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }}>
            {RESULTS.map((r) => <option key={r} value={r}>{r || 'All results'}</option>)}
          </select>
        </Field>
        {data && <p className="mb-2 text-sm text-slate-500">{data.total} check(s)</p>}
      </div>
      <Msg error={error} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : data?.items.length === 0 ? <Empty>No checks recorded{result ? ` with the result ${result}` : ''}.</Empty> : (
        <>
          <Table head={['When', 'Result', 'How it was checked', 'Card', 'Staff member', 'Checked by']}>
            {data?.items.map((s: Row) => (
              <tr key={s.id}>
                <td className={td}>{when(s.createdAt)}</td>
                <td className={td}><span className={`rounded px-2 py-0.5 text-xs font-semibold ${TONE[s.result] ?? ''}`}>{s.result}</span></td>
                <td className={td}>{s.method.replace(/_/g, ' ').toLowerCase()}</td>
                <td className={td}>{s.cardNumber ?? <span className="text-slate-400">not recognised (“{s.presented}…”)</span>}</td>
                <td className={td}>{s.staffName ? `${s.staffName} (${s.staffId})` : '—'}</td>
                <td className={`${td} text-xs text-slate-500`}>{s.scannedByIdentityId ? 'signed-in staff' : 'public link'}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}

export default function CardHistoryPage() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF', 'AUDITOR']}>
      <AppShell title="Card Verification History" navLinks={navForRoles(user?.roles ?? [])}>
        <History />
      </AppShell>
    </ProtectedRoute>
  );
}
