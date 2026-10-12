'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PublicApiError, publicRequest } from '@/lib/public-api';

type Result = 'CONFIRMED' | 'ALREADY_CONFIRMED' | 'EXPIRED' | 'INVALID';

const TEXT: Record<Result, { title: string; body: string; ok: boolean }> = {
  CONFIRMED: { title: 'You are subscribed', body: 'Thank you. You will now receive the updates you chose. You can change your mind at any time using the link in every message.', ok: true },
  ALREADY_CONFIRMED: { title: 'Already confirmed', body: 'This subscription was confirmed earlier. Nothing has changed.', ok: true },
  EXPIRED: { title: 'This link has expired', body: 'Please fill in the sign-up form again and we will send a new link.', ok: false },
  INVALID: { title: 'This link is not valid', body: 'It may have been replaced by a newer one, or you may have unsubscribed since. Fill in the sign-up form again if you would like to subscribe.', ok: false },
};

/** A button, not an automatic action: a mail scanner that opens every link must not confirm anyone's subscription. */
export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await publicRequest<{ result: Result }>('POST', `/public/comm/confirm/${encodeURIComponent(token)}`);
      setResult(r.result);
    } catch (e) {
      setError(e instanceof PublicApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const shown = result ? TEXT[result] : null;
  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Alnajoum Travel Agency</p>
      <h1 className="mt-1 text-xl font-bold text-slate-900">Confirm your subscription</h1>
      {!shown ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">Press the button to confirm that you asked to receive travel offers and updates. If this was not you, simply close this page and nothing will be sent.</p>
          {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button onClick={confirm} disabled={busy} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? 'Confirming…' : 'Yes, confirm my subscription'}
          </button>
        </div>
      ) : (
        <div role="status" className={`mt-4 rounded-lg border p-4 text-sm ${shown.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          <p className="font-semibold">{shown.title}</p>
          <p className="mt-1">{shown.body}</p>
          {!shown.ok && <a className="mt-3 inline-block underline" href="/subscribe">Go to the sign-up form</a>}
        </div>
      )}
    </main>
  );
}
