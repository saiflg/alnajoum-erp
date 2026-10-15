'use client';

import Link from 'next/link';
import { CommPage } from '@/components/comm/CommPage';
import { Badge, Empty, Msg, PageTitle, Row, Stat, Table, card, td, when } from '@/components/comm/ui';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

const INTENT_TEXT: Record<string, string> = {
  OPT_OUT: 'Asked to stop (unsubscribed)', OPT_OUT_UNCLEAR: 'Unclear “stop” — asked them to clarify', OPT_IN: 'Asked to subscribe', CONFIRM: 'Confirmed a subscription',
  PACKAGE: 'Asked about a package or price', FLIGHT: 'Asked about flights', VISA: 'Asked about a visa', HAJJ_UMRAH: 'Asked about Hajj or Umrah',
  BOOKING_STATUS: 'Asked about a booking', HUMAN: 'Asked for a person', FAQ: 'General question',
};

function Reports() {
  const { user } = useAuth();
  const allowed = !!user?.permissions.includes('comm:report:view');
  const { data: sum, error } = useApi<Row>(allowed ? '/comm/campaigns/summary' : null);
  const { data: health } = useApi<Row>(allowed ? '/comm/integrations/health' : null);

  return (
    <>
      <PageTitle title="Delivery reports" subtitle="What happened to the messages. Only what a provider actually reports is shown: no opens are tracked, and a figure a channel cannot give is left out, never estimated." />
      {!allowed && <Msg error="Your role does not include access to reports." />}
      <Msg error={error} />
      {health && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {(['whatsapp', 'email'] as const).map((k) => {
            const h = health[k];
            return (
              <div key={k} className={card}>
                <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{k === 'email' ? 'Email' : 'WhatsApp'}</h2><Badge value={h.mode === 'SIMULATOR' ? 'SIMULATED' : h.ok ? 'OK' : 'FAILED'} /></div>
                <p className="mt-1 text-xs text-slate-600">{h.detail}</p>
              </div>
            );
          })}
        </div>
      )}
      {sum && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Going out or waiting" value={sum.live} hint="awaiting approval, scheduled, sending or paused" />
            <Stat label="Finished" value={sum.byStatus.COMPLETED ?? 0} />
            <Stat label="Failed" value={sum.byStatus.FAILED ?? 0} />
            <Stat label="Need review" value={sum.needsReview} hint="a send whose outcome is unknown; never resent automatically" />
          </div>
          <h2 className="mb-2 text-sm font-semibold">Recent campaigns</h2>
          {sum.recent.length === 0 ? <Empty>No campaign has been sent yet.</Empty> : (
            <Table head={['Campaign', 'Channel', 'Status', 'Audience', 'Started', 'Finished']}>
              {sum.recent.map((c: Row) => (
                <tr key={c.id}>
                  <td className={td}><Link className="font-medium text-amber-700 hover:underline" href={`/admin/communication/campaigns/${c.id}`}>{c.name}</Link></td>
                  <td className={td}>{c.channel.toLowerCase()}</td>
                  <td className={td}><Badge value={c.status} />{c.simulated && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">simulated</span>}</td>
                  <td className={td}>{c.eligibleCount}</td>
                  <td className={td}>{when(c.startedAt)}</td>
                  <td className={td}>{when(c.completedAt)}</td>
                </tr>
              ))}
            </Table>
          )}
          <h2 className="mb-2 mt-8 text-sm font-semibold">What people wrote to us on WhatsApp — last 30 days</h2>
          {Object.keys(sum.inbound).length === 0 ? <Empty>Nothing to report.</Empty> : (
            <div className={card}>
              <ul className="divide-y divide-slate-100 text-sm">
                {Object.entries<number>(sum.inbound).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k} className="flex justify-between py-1.5"><span>{INTENT_TEXT[k] ?? k}</span><b>{n}</b></li>)}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">Messages are labelled by topic for routing. The system never answers one with a price, availability, visa outcome or booking or payment status it has not read from the live record.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <CommPage title="Delivery reports">
      <Reports />
    </CommPage>
  );
}
