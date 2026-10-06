'use client';

import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/format';
import type { Comparison, MetricResult } from '@/lib/analytics-types';

/** For these, a rise is bad news, so the colours flip. */
const LOWER_IS_BETTER = new Set(['cancellations', 'support_tickets']);

const ACCENT: Record<MetricResult['domain'], string> = {
  SALES: 'from-sky-400/30',
  FINANCE: 'from-emerald-400/30',
  CUSTOMERS: 'from-violet-400/30',
  SUPPORT: 'from-amber-400/30',
};

export function formatMetric(value: number, unit: MetricResult['unit'], currency: string): string {
  switch (unit) {
    case 'CURRENCY':
      return formatCurrency(value, currency);
    case 'PERCENT':
      return `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
    case 'MINUTES':
      return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`;
    default:
      return value.toLocaleString('en-GB');
  }
}

/** Shows exactly what the API said about the comparison — never a made-up delta. */
export function DeltaChip({ comparison, metricKey, unit }: { comparison: Comparison | null; metricKey: string; unit: MetricResult['unit'] }) {
  if (!comparison) return null;
  const neutral = 'bg-slate-100 text-slate-600';

  if (comparison.status === 'NO_BASELINE') return <span className={`rounded-full px-2 py-0.5 text-[11px] ${neutral}`}>No earlier data</span>;
  if (comparison.status === 'INSUFFICIENT_DATA') return <span className={`rounded-full px-2 py-0.5 text-[11px] ${neutral}`} title={comparison.note}>Insufficient history</span>;

  if (comparison.changePercent === null) {
    const text = comparison.change === 0 ? 'No change' : 'New — nothing to compare with';
    return <span className={`rounded-full px-2 py-0.5 text-[11px] ${neutral}`} title={comparison.note}>{text}</span>;
  }

  const up = comparison.direction === 'UP';
  const flat = comparison.direction === 'FLAT';
  const good = flat ? null : LOWER_IS_BETTER.has(metricKey) ? !up : up;
  const tone = good === null ? neutral : good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
  const arrow = flat ? '■' : up ? '▲' : '▼';
  // A percentage-of-a-percentage is confusing; for PERCENT metrics show the point change instead.
  const text = unit === 'PERCENT' && comparison.change !== null ? `${Math.abs(comparison.change).toLocaleString('en-GB', { maximumFractionDigits: 2 })} pts` : `${Math.abs(comparison.changePercent).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`} title={comparison.note}>
      {arrow} {text}
    </span>
  );
}

const plural = (n: number, word: string): string => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

function detailLine(m: MetricResult, currency: string): string | null {
  const d = m.details ?? {};
  switch (m.key) {
    case 'gross_margin': {
      const cov = d.costCoveragePercent as number | null | undefined;
      const pct = d.marginPercentOfCostedValue as number | null | undefined;
      return [cov != null ? `cost known for ${cov}% of bookings` : null, pct != null ? `${pct}% of costed sales` : null].filter(Boolean).join(' · ');
    }
    case 'booked_value':
      return `Flights ${formatCurrency((d.flights as number) ?? 0, currency)} · Hotels ${formatCurrency((d.hotels as number) ?? 0, currency)}`;
    case 'bookings_count':
      return `${plural((d.flights as number) ?? 0, 'flight')} · ${plural((d.hotels as number) ?? 0, 'hotel')}`;
    case 'support_tickets': {
      const rate = d.slaBreachRatePercent as number | null | undefined;
      const avg = d.avgFirstResponseMinutes as number | null | undefined;
      return [rate != null ? `${rate}% breached SLA` : null, avg != null ? `avg first reply ${formatMetric(avg, 'MINUTES', currency)}` : null].filter(Boolean).join(' · ') || null;
    }
    case 'cash_collected':
      return plural((d.payments as number) ?? 0, 'payment');
    case 'receivables_outstanding':
      return `${plural((d.openInvoices as number) ?? 0, 'open invoice')}`;
    case 'supplier_payables_outstanding':
      return `${plural((d.openPayables as number) ?? 0, 'open payable')}`;
    case 'repeat_customer_rate':
      return d.repeatCustomers != null ? `${d.repeatCustomers as number} of ${d.activeCustomers as number} returning` : null;
    default:
      return null;
  }
}

export function KpiCard({ metric, currency, index }: { metric: MetricResult; currency: string; index: number }) {
  const unavailable = metric.status === 'UNAVAILABLE' || metric.value === null;
  const sub = unavailable ? null : detailLine(metric, currency);
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-lg hover:shadow-slate-900/10"
    >
      <div className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${ACCENT[metric.domain]} to-transparent blur-2xl transition-transform duration-500 group-hover:scale-150`} />
      <div className="relative flex items-start justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{metric.name}</h3>
        {metric.accuracy === 'APPROXIMATE' && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="Approximate — see the definition for why">
            ≈
          </span>
        )}
      </div>

      {unavailable ? (
        <div className="relative mt-2">
          <p className="text-lg font-semibold text-slate-400">Not available</p>
          <p className="mt-1 text-xs leading-snug text-slate-500">{metric.unavailableReason}</p>
        </div>
      ) : (
        <div className="relative">
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {formatMetric(metric.value as number, metric.unit, currency)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DeltaChip comparison={metric.comparison} metricKey={metric.key} unit={metric.unit} />
            {metric.comparison?.status === 'OK' && metric.comparison.previous !== null && (
              <span className="text-[11px] text-slate-400">was {formatMetric(metric.comparison.previous, metric.unit, currency)}</span>
            )}
          </div>
          {sub && <p className="mt-2 text-xs leading-snug text-slate-500">{sub}</p>}
        </div>
      )}
    </motion.article>
  );
}
