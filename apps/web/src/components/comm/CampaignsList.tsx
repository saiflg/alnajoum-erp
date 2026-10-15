'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CampaignBuilder } from '@/components/comm/CampaignBuilder';
import { Badge, Empty, Field, Msg, PageTitle, Pager, Row, Table, btn, input, td, when } from '@/components/comm/ui';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const PAGE_SIZE = 20;
const STATUSES = ['', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'];

export function CampaignsList({ channel }: { channel: 'WHATSAPP' | 'EMAIL' }) {
  const { user } = useAuth();
  const router = useRouter();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams({ channel, page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) qs.set('status', status);
  const { data, error, loading } = useApi<Row>(can('comm:campaign:read') ? `/comm/campaigns?${qs.toString()}` : null);
  const label = channel === 'EMAIL' ? 'Email' : 'WhatsApp';

  return (
    <>
      <PageTitle
        title={`${label} campaigns`}
        subtitle={channel === 'WHATSAPP'
          ? 'Promotional WhatsApp messages to people who agreed to receive them, using approved templates. A second person approves every campaign before it can be sent.'
          : 'Marketing emails to people who agreed (and confirmed) to receive them. Every email carries an unsubscribe link. A second person approves every campaign.'}
        actions={can('comm:campaign:create') ? <button className={btn} onClick={() => setCreating(true)}>New campaign</button> : undefined}
      />
      {!can('comm:campaign:read') && <Msg error="Your role does not include access to campaigns." />}
      <div className="mb-3 flex items-end gap-3">
        <Field label="Status"><select className={`${input} w-48`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ').toLowerCase() : 'All'}</option>)}</select></Field>
      </div>
      <Msg error={error} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : data?.items.length === 0 ? (
        <Empty>No {label.toLowerCase()} campaigns yet.{can('comm:campaign:create') ? ' Use “New campaign” to write the first one.' : ''}</Empty>
      ) : (
        <>
          <Table head={['Campaign', 'Status', 'Segment', 'Template', 'Can receive', 'When', '']}>
            {data?.items.map((c: Row) => (
              <tr key={c.id}>
                <td className={td}><p className="font-medium text-slate-900">{c.name}</p><p className="text-xs text-slate-500">topic: {c.topic}</p></td>
                <td className={td}><Badge value={c.status} />{c.simulated && <p className="mt-1"><span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">simulated</span></p>}</td>
                <td className={td}>{c.segment?.name ?? '—'}</td>
                <td className={td}>{c.template ? `${c.template.name} (${c.template.language})` : c.subject ? 'Own text' : '—'}</td>
                <td className={td}>{c.status === 'DRAFT' ? '—' : c.eligibleCount}</td>
                <td className={td}>{c.scheduledAt ? when(c.scheduledAt) : c.startedAt ? when(c.startedAt) : '—'}</td>
                <td className={`${td} text-right`}><Link className="text-xs font-medium text-amber-700 hover:underline" href={`/admin/communication/campaigns/${c.id}`}>Open</Link></td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
      {creating && <CampaignBuilder channel={channel} onClose={() => setCreating(false)} onDone={(id) => router.push(`/admin/communication/campaigns/${id}`)} />}
    </>
  );
}
