'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Verification, VerificationPanel } from '@/components/staff-cards/VerificationPanel';
import { apiFileUrl } from '@/lib/api';

type State = { kind: 'loading' } | { kind: 'done'; v: Verification } | { kind: 'offline' } | { kind: 'busy' };

/**
 * What someone sees after scanning a staff card: the card's CURRENT status, asked of the server each time. Nothing
 * here depends on what is printed on the card, and the link grants no access to anything.
 */
export default function VerifyCardPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(apiFileUrl(`/public/staff-cards/${encodeURIComponent(token)}`), { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 429) return !cancelled && setState({ kind: 'busy' });
        const body = await res.json();
        if (!res.ok || !body?.data) throw new Error('bad response');
        if (!cancelled) setState({ kind: 'done', v: body.data as Verification });
      })
      .catch(() => !cancelled && setState({ kind: 'offline' }));
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Alnajoum Travel Agency</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Staff card verification</h1>
        <p className="mt-1 text-sm text-slate-500">This result comes from our live records.</p>
      </header>

      {state.kind === 'loading' && <p className="text-center text-sm text-slate-500" role="status">Checking this card…</p>}
      {state.kind === 'done' && <VerificationPanel v={state.v} photoUrl={state.v.staff?.hasPhoto ? apiFileUrl(`/public/staff-cards/${encodeURIComponent(token)}/photo`) : null} />}
      {state.kind === 'offline' && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <p className="font-semibold">Could not check this card</p>
          <p className="mt-1">We could not reach the verification service. Do not accept the card as identification until it has been checked.</p>
          <button className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => { setState({ kind: 'loading' }); setAttempt((n) => n + 1); }}>Try again</button>
        </div>
      )}
      {state.kind === 'busy' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <p className="font-semibold">Too many checks</p>
          <p className="mt-1">Please wait a minute and scan again.</p>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        Only a card showing <b>VALID — ACTIVE CARD</b> identifies a member of staff. This page cannot sign anyone in or authorise any payment.
      </p>
    </main>
  );
}
