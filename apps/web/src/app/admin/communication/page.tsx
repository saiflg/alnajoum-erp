'use client';

import Link from 'next/link';
import { CommPage } from '@/components/comm/CommPage';
import { Badge, Empty, Msg, PageTitle, Row, Stat, btnGhost, card, when } from '@/components/comm/ui';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';

function Overview() {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const { data, error, loading } = useApi<Row>(can('comm:contact:read') ? '/comm/overview' : null);

  return (
    <>
      <PageTitle
        title="Communication Centre"
        subtitle="Contacts, consent and messages. Having someone in this list never means we may market to them: every channel has its own consent, recorded with the wording they saw."
        actions={
          <>
            <Link className={btnGhost} href="/admin/communication/contacts">Contacts</Link>
            <Link className={btnGhost} href="/subscribe" target="_blank">Public sign-up page</Link>
          </>
        }
      />
      {!can('comm:contact:read') && <Msg error="Your role does not include access to contacts." />}
      <Msg error={error} />
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Contacts" value={data.contacts} hint={Object.entries<number>(data.byKind ?? {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'none yet'} />
            <Stat label="WhatsApp subscribers" value={data.whatsapp.subscribed} hint={`${data.whatsapp.pending} awaiting confirmation`} />
            <Stat label="Email subscribers" value={data.email.subscribed} hint={`${data.email.pending} awaiting confirmation`} />
            <Stat label="On the do-not-send list" value={data.whatsapp.suppressed + data.email.suppressed} hint={`${data.whatsapp.suppressed} WhatsApp · ${data.email.suppressed} email`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={card}>
              <h2 className="text-sm font-semibold">Unsubscribed</h2>
              <p className="mt-1 text-sm text-slate-600">{data.whatsapp.unsubscribed} on WhatsApp · {data.email.unsubscribed} by email</p>
              <p className="mt-2 text-xs text-slate-400">These people are never messaged with marketing again unless they subscribe anew themselves.</p>
            </div>
            <div className={card}>
              <h2 className="text-sm font-semibold">Latest consent activity</h2>
              {data.recentConsent.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing recorded yet.</p> : (
                <ul className="mt-2 divide-y divide-slate-100 text-sm">
                  {data.recentConsent.map((r: Row) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link className="font-medium text-amber-700 hover:underline" href={`/admin/communication/contacts/${r.contact.id}`}>{r.contact.fullName}</Link>
                      <span className="text-xs text-slate-500">{r.channel.toLowerCase()} · {r.source.toLowerCase().replace(/_/g, ' ')}</span>
                      <Badge value={r.action} />
                      <span className="text-xs text-slate-400">{when(r.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {data.contacts === 0 && <Empty>No contacts yet. Add one, import a CSV file, or share the public sign-up page.</Empty>}
        </div>
      )}
    </>
  );
}

export default function CommunicationOverviewPage() {
  return (
    <CommPage title="Communication Centre">
      <Overview />
    </CommPage>
  );
}
