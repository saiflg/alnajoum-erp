'use client';

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { FlightOfferCard, offerMinutes, offerStops, OfferSkeleton } from '@/components/flights/FlightOfferCard';
import { FlightSearchForm } from '@/components/flights/FlightSearchForm';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { buildApiLegs, buildSearchBody, decodeSearchParams, FlightSearchState } from '@/lib/flight-search';
import { formatCurrency } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { FlightOffer } from '@/lib/types';

type SortKey = 'price' | 'duration' | 'departure';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'price', label: 'Cheapest' },
  { key: 'duration', label: 'Fastest' },
  { key: 'departure', label: 'Earliest' },
];

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        on
          ? 'border-amber-500 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      }`}
    >
      {on ? '✓ ' : ''}
      {children}
    </button>
  );
}

function FlightSearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Prefilled from the homepage hero search (carried through register/login)
  // — read once at initialisation, the URL is already known on first render.
  const [search, setSearch] = useState<FlightSearchState>(() => decodeSearchParams(searchParams));

  const [offers, setOffers] = useState<FlightOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedRoute, setSearchedRoute] = useState('');

  const [sort, setSort] = useState<SortKey>('price');
  const [directOnly, setDirectOnly] = useState(false);
  const [refundableOnly, setRefundableOnly] = useState(false);

  async function runSearch(state: FlightSearchState) {
    setError(null);
    setSearching(true);
    setOffers(null);
    setSearchedRoute(
      buildApiLegs(state)
        .map((l) => `${l.origin} → ${l.destination}`)
        .join('  ·  '),
    );
    try {
      setOffers(await apiRequest<FlightOffer[]>('/flights/search', { method: 'POST', body: buildSearchBody(state) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Flight search failed');
    } finally {
      setSearching(false);
    }
  }

  const visible = useMemo(() => {
    if (!offers) return null;
    const filtered = offers.filter(
      (o) =>
        (!directOnly || offerStops(o) === 0) &&
        (!refundableOnly || o.fareConditions?.refundable === 'REFUNDABLE'),
    );
    return [...filtered].sort((a, b) =>
      sort === 'price'
        ? a.totalAmount - b.totalAmount
        : sort === 'duration'
          ? offerMinutes(a) - offerMinutes(b)
          : new Date(a.legs[0].departureAt).getTime() - new Date(b.legs[0].departureAt).getTime(),
    );
  }, [offers, sort, directOnly, refundableOnly]);

  const cheapest = offers && offers.length ? Math.min(...offers.map((o) => o.totalAmount)) : null;

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Book a Flight" navLinks={PORTAL_NAV}>
        <div className="mx-auto max-w-5xl">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-8"
          >
            <motion.div
              aria-hidden
              animate={{ x: [0, 24, 0], y: [0, -12, 0] }}
              transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
              className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-amber-500/20 blur-3xl"
            />
            <div className="relative">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Where to next?</h2>
              <p className="mt-1 text-sm text-slate-300">
                One way, round trip, or build a multi-city journey with up to six flights.
              </p>
              <div className="mt-5 rounded-2xl bg-white p-5 shadow-2xl shadow-black/30">
                <FlightSearchForm
                  idPrefix="portal"
                  value={search}
                  onChange={setSearch}
                  onSubmit={runSearch}
                  busy={searching}
                />
              </div>
            </div>
          </motion.section>

          <AnimatePresence>
            {error && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {searching && (
            <div className="mt-6 space-y-3" aria-busy="true" aria-label="Searching flights">
              <p className="text-sm text-slate-500">Searching {searchedRoute}…</p>
              {[0, 1, 2].map((i) => (
                <OfferSkeleton key={i} />
              ))}
            </div>
          )}

          {visible && offers && (
            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {visible.length} of {offers.length} flight{offers.length === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {searchedRoute}
                    {cheapest != null && offers[0] && <> · from {formatCurrency(cheapest, offers[0].currency)}</>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LayoutGroup id="sort">
                    <div className="inline-flex rounded-full bg-slate-100 p-1">
                      {SORTS.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => setSort(s.key)}
                          className={`relative rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            sort === s.key ? 'text-white' : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {sort === s.key && (
                            <motion.span
                              layoutId="sort-pill"
                              className="absolute inset-0 rounded-full bg-slate-900"
                              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            />
                          )}
                          <span className="relative">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </LayoutGroup>
                  <Toggle on={directOnly} onClick={() => setDirectOnly((v) => !v)}>
                    Direct only
                  </Toggle>
                  <Toggle on={refundableOnly} onClick={() => setRefundableOnly((v) => !v)}>
                    Refundable
                  </Toggle>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <AnimatePresence mode="popLayout">
                  {visible.map((offer, i) => (
                    <FlightOfferCard
                      key={offer.id}
                      offer={offer}
                      index={i}
                      onSelect={() => router.push(`/portal/flights/book/${offer.id}`)}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {visible.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
                >
                  <p className="text-3xl">🛫</p>
                  <p className="mt-2 text-sm font-medium text-slate-800">
                    {offers.length === 0 ? 'No flights found for that search.' : 'No flights match your filters.'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {offers.length === 0
                      ? 'Try different dates or nearby airports.'
                      : 'Turn off a filter to see more options.'}
                  </p>
                </motion.div>
              )}
            </section>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

export default function FlightSearchPage() {
  return (
    <Suspense fallback={null}>
      <FlightSearchPageContent />
    </Suspense>
  );
}
