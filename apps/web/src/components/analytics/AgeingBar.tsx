'use client';

import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/format';
import type { AgeingRow } from '@/lib/analytics-types';

const COLOURS = ['bg-emerald-400', 'bg-sky-400', 'bg-amber-400', 'bg-orange-500', 'bg-rose-500', 'bg-slate-400'];

/** One stacked bar plus a legend, so both the proportions and the exact amounts are readable. */
export function AgeingBar({ title, caption, rows, currency }: { title: string; caption: string; rows: AgeingRow[]; currency: string }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(total, currency)}</p>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{caption}</p>

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nothing outstanding.</p>
      ) : (
        <>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${formatCurrency(r.amount, currency)}`).join(', ')}`}>
            {rows.map((r, i) =>
              r.amount > 0 ? (
                <motion.div
                  key={r.key}
                  className={COLOURS[i % COLOURS.length]}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.amount / total) * 100}%` }}
                  transition={{ duration: 0.7, delay: i * 0.06, ease: 'easeOut' }}
                  title={`${r.label}: ${formatCurrency(r.amount, currency)}`}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-4 space-y-1.5">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 text-slate-600">
                  <span className={`h-2.5 w-2.5 rounded-sm ${COLOURS[i % COLOURS.length]}`} />
                  {r.label}
                  <span className="text-slate-400">({r.count})</span>
                </span>
                <span className="tabular-nums text-slate-800">{formatCurrency(r.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
