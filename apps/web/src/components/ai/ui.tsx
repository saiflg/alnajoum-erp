'use client';

import { ReactNode, useState } from 'react';
import { errorText } from '@/lib/use-api';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = any;

export const card = 'rounded-lg border border-slate-200 bg-white p-4';
export const th = 'px-3 py-2 text-left font-medium text-slate-600';
export const td = 'px-3 py-2 text-slate-700 align-top';
export const btn = 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50';
export const btnGhost = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const btnDanger = 'rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50';
export const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

const TONES: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-slate-100 text-slate-700',
  OK: 'bg-emerald-100 text-emerald-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PUBLISHED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  EXECUTED: 'bg-emerald-100 text-emerald-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  WAITING_APPROVAL: 'bg-amber-100 text-amber-800',
  DRAFT: 'bg-slate-100 text-slate-700',
  FAILED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-red-100 text-red-800',
  DENIED: 'bg-red-100 text-red-800',
  DISABLED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
  HANDED_OFF: 'bg-violet-100 text-violet-800',
  ESCALATED: 'bg-violet-100 text-violet-800',
  HIGH_RISK: 'bg-red-100 text-red-800',
  MEDIUM_RISK: 'bg-amber-100 text-amber-800',
  LOW_RISK_WRITE: 'bg-sky-100 text-sky-800',
  READ_ONLY: 'bg-emerald-100 text-emerald-800',
  SIMULATED: 'bg-sky-100 text-sky-800',
};

export function Badge({ value }: { value: string }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[value] ?? 'bg-slate-100 text-slate-700'}`}>{value.replace(/_/g, ' ')}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

export function Msg({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-700">{notice}</p>}
    </>
  );
}

/** Runs an action, shows its error or success note, and bumps a counter so lists reload. */
export function useAction(bump: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      if (done) setNotice(done);
      bump();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { act, error, notice, busy };
}

export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
export const usd = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(4)}`);
