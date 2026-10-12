'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PublicApiError, publicRequest } from '@/lib/public-api';

type Channel = 'EMAIL' | 'WHATSAPP' | 'ALL';
const LABEL: Record<Channel, string> = { EMAIL: 'email', WHATSAPP: 'WhatsApp', ALL: 'email and WhatsApp' };

function Unsubscribe() {
  const { token } = useParams<{ token: string }>();
  const params = useSearchParams();
  const raw = params.get('channel');
  const channel: Channel = raw === 'WHATSAPP' || raw === 'ALL' ? raw : 'EMAIL';
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(which: Channel) {
    setBusy(true);
    setError(null);
    try {
      const r = await publicRequest<{ message: string }>('POST', `/public/comm/unsubscribe/${encodeURIComponent(token)}`, { channel: which });
      setDone(r.message);
    } catch (e) {
      setError(e instanceof PublicApiError && e.status === 404 ? 'This link is not valid any more.' : e instanceof PublicApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Alnajoum Travel Agency</p>
      <h1 className="mt-1 text-xl font-bold text-slate-900">Unsubscribe</h1>
      {done ? (
        <div role="status" className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Done</p>
          <p className="mt-1">{done}</p>
          <a className="mt-3 inline-block underline" href={`/preferences/${encodeURIComponent(token)}`}>Change your preferences instead</a>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">
            Stop {LABEL[channel]} marketing from us. This takes effect immediately. Messages about your own bookings and payments will still reach you.
          </p>
          {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button onClick={() => go(channel)} disabled={busy} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? 'Working…' : `Unsubscribe from ${LABEL[channel]} marketing`}
          </button>
          {channel !== 'ALL' && (
            <button onClick={() => go('ALL')} disabled={busy} className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Unsubscribe from everything
            </button>
          )}
          <a className="block text-center text-sm text-slate-500 underline" href={`/preferences/${encodeURIComponent(token)}`}>Choose what I receive instead</a>
        </div>
      )}
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading…</p>}>
      <Unsubscribe />
    </Suspense>
  );
}
