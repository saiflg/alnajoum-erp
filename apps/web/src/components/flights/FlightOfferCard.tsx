'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { formatCurrency, formatDuration } from '@/lib/format';
import { FlightLegOffer, FlightOffer } from '@/lib/types';

const EASE = [0.22, 1, 0.36, 1] as const;

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function legMinutes(leg: FlightLegOffer): number {
  return Math.max(0, Math.round((new Date(leg.arrivalAt).getTime() - new Date(leg.departureAt).getTime()) / 60000));
}

export function offerMinutes(offer: FlightOffer): number {
  return offer.legs.reduce((sum, leg) => sum + legMinutes(leg), 0);
}

export function offerStops(offer: FlightOffer): number {
  return offer.legs.reduce((max, leg) => Math.max(max, leg.segments.length - 1), 0);
}

const REFUND_STYLES: Record<string, string> = {
  REFUNDABLE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PARTIALLY_REFUNDABLE: 'bg-amber-50 text-amber-700 ring-amber-200',
  NON_REFUNDABLE: 'bg-rose-50 text-rose-700 ring-rose-200',
  UNKNOWN: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function LegTimeline({ leg, label }: { leg: FlightLegOffer; label?: string }) {
  const stops = leg.segments.length - 1;
  const airlines = Array.from(new Set(leg.segments.map((s) => s.airline))).join(' + ');
  const numbers = leg.segments.map((s) => s.flightNumber).join(' · ');

  return (
    <div>
      {label && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-600">{label}</p>
      )}
      <div className="flex items-center gap-3 sm:gap-5">
        <div className="min-w-16 text-left">
          <p className="text-2xl font-semibold tabular-nums text-slate-900">{time(leg.departureAt)}</p>
          <p className="text-sm font-medium text-slate-700">{leg.origin}</p>
          <p className="text-xs text-slate-500">{day(leg.departureAt)}</p>
        </div>

        <div className="flex-1">
          <p className="text-center text-xs text-slate-500">{formatDuration(legMinutes(leg))}</p>
          <div className="relative my-1 flex items-center">
            <span className="h-2 w-2 rounded-full border-2 border-slate-400 bg-white" />
            <span className="relative h-px flex-1 bg-slate-300">
              {Array.from({ length: stops }).map((_, i) => (
                <span
                  key={i}
                  className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-amber-500"
                  style={{ left: `${((i + 1) / (stops + 1)) * 100}%` }}
                />
              ))}
              <motion.span
                aria-hidden
                initial={{ left: '0%' }}
                animate={{ left: '100%' }}
                transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
                className="absolute -top-2 -translate-x-1/2 text-xs text-slate-400"
              >
                ✈
              </motion.span>
            </span>
            <span className="h-2 w-2 rounded-full bg-slate-700" />
          </div>
          <p className={`text-center text-xs font-medium ${stops === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {stops === 0 ? 'Direct' : `${stops} stop${stops > 1 ? 's' : ''}`}
          </p>
        </div>

        <div className="min-w-16 text-right">
          <p className="text-2xl font-semibold tabular-nums text-slate-900">{time(leg.arrivalAt)}</p>
          <p className="text-sm font-medium text-slate-700">{leg.destination}</p>
          <p className="text-xs text-slate-500">{day(leg.arrivalAt)}</p>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {airlines} · {numbers}
      </p>
    </div>
  );
}

export function FlightOfferCard({
  offer,
  index,
  onSelect,
}: {
  offer: FlightOffer;
  index: number;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fc = offer.fareConditions;
  const tripLabel =
    offer.tripType === 'ONE_WAY' ? 'One way' : offer.tripType === 'ROUND_TRIP' ? 'Round trip' : 'Multi-city';
  const legLabel = (i: number) =>
    offer.tripType === 'ROUND_TRIP' ? (i === 0 ? 'Outbound' : 'Return') : offer.tripType === 'MULTI_CITY' ? `Flight ${i + 1}` : undefined;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45, delay: Math.min(index, 8) * 0.05, ease: EASE }}
      whileHover={{ y: -2 }}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-xl hover:shadow-slate-900/10"
    >
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:gap-8">
        <div className="space-y-5">
          {offer.legs.map((leg, i) => (
            <LegTimeline key={i} leg={leg} label={legLabel(i)} />
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {offer.cabinClass.replace('_', ' ')}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{tripLabel}</span>
            {fc && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${REFUND_STYLES[fc.refundable] ?? REFUND_STYLES.UNKNOWN}`}
              >
                {fc.refundable.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}
              </span>
            )}
            {fc?.fareBrand && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
                {fc.fareBrand}
              </span>
            )}
            {fc?.baggageAllowance?.checked && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                🧳 {fc.baggageAllowance.checked}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-dashed border-slate-200 pt-4 sm:flex-col sm:items-end sm:justify-center sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
          <div className="sm:text-right">
            <p className="text-2xl font-bold tracking-tight text-slate-900">
              {formatCurrency(offer.totalAmount, offer.currency)}
            </p>
            <p className={`text-xs ${offer.seatsAvailable <= 4 ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
              {offer.seatsAvailable <= 4 ? `Only ${offer.seatsAvailable} left` : `${offer.seatsAvailable} seats left`}
            </p>
          </div>
          <motion.button
            type="button"
            onClick={onSelect}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-slate-900/20 transition-colors hover:bg-amber-500 hover:text-slate-900"
          >
            Select
          </motion.button>
        </div>
      </div>

      {fc && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
          >
            <span>
              Fare rules
              {fc.warnings.length > 0 && <span className="ml-2 text-amber-600">⚠ {fc.warnings.length} to review</span>}
            </span>
            <motion.span animate={{ rotate: open ? 180 : 0 }}>▾</motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="overflow-hidden bg-slate-50/70"
              >
                <dl className="grid gap-3 px-5 pb-4 pt-1 text-sm sm:grid-cols-2">
                  {fc.changePenaltyDescription && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Changes</dt>
                      <dd className="text-slate-700">{fc.changePenaltyDescription}</dd>
                    </div>
                  )}
                  {fc.cancellationPenaltyDescription && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cancellation</dt>
                      <dd className="text-slate-700">{fc.cancellationPenaltyDescription}</dd>
                    </div>
                  )}
                  {fc.baggageAllowance && (fc.baggageAllowance.checked || fc.baggageAllowance.cabin) && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Baggage</dt>
                      <dd className="text-slate-700">
                        {[fc.baggageAllowance.checked && `Checked: ${fc.baggageAllowance.checked}`, fc.baggageAllowance.cabin && `Cabin: ${fc.baggageAllowance.cabin}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </div>
                  )}
                  {!fc.changePenaltyDescription && !fc.cancellationPenaltyDescription && fc.warnings.length === 0 && (
                    <p className="text-slate-500">The provider returned no further fare rules for this offer.</p>
                  )}
                  {fc.warnings.length > 0 && (
                    <div className="sm:col-span-2">
                      {fc.warnings.map((w, i) => (
                        <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          ⚠ {w.message}
                          {!w.verified && ' (could not be automatically verified)'}
                        </p>
                      ))}
                    </div>
                  )}
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.article>
  );
}

export function OfferSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-5">
        <div className="h-14 w-16 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-2 flex-1 animate-pulse rounded-full bg-slate-200" />
        <div className="h-14 w-16 animate-pulse rounded-lg bg-slate-200" />
        <div className="ml-6 hidden h-12 w-28 animate-pulse rounded-lg bg-slate-200 sm:block" />
      </div>
      <div className="mt-4 flex gap-2">
        <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
        <div className="h-6 w-24 animate-pulse rounded-full bg-slate-100" />
      </div>
    </div>
  );
}
