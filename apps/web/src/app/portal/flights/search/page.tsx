'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { AirportInput } from '@/components/AirportInput';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, formatDuration } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { CabinClass, FlightLegCriteria, FlightOffer, TripType } from '@/lib/types';

const CABIN_CLASSES: CabinClass[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

const TRIP_TYPES: Array<{ value: TripType; label: string }> = [
  { value: 'ONE_WAY', label: 'One way' },
  { value: 'ROUND_TRIP', label: 'Round trip' },
  { value: 'MULTI_CITY', label: 'Multi-city' },
];

const MIN_MULTI_CITY_LEGS = 2;
const MAX_LEGS = 6;

function emptyLeg(): FlightLegCriteria {
  return { origin: '', destination: '', departureDate: '' };
}

function FlightSearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tripType, setTripType] = useState<TripType>('ONE_WAY');
  // Prefills from the marketing site's search teaser, carried through
  // registration/login (?origin=&destination=&date=) — read once at
  // initialization rather than via an effect, since the URL is already
  // known on first render and doesn't need to "synchronize" afterward.
  const [legs, setLegs] = useState<FlightLegCriteria[]>(() => {
    const origin = searchParams.get('origin');
    const destination = searchParams.get('destination');
    const date = searchParams.get('date');
    return origin || destination || date
      ? [{ origin: origin ?? '', destination: destination ?? '', departureDate: date ?? '' }]
      : [emptyLeg()];
  });
  const [returnDate, setReturnDate] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabinClass, setCabinClass] = useState<CabinClass>('ECONOMY');

  const [offers, setOffers] = useState<FlightOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTripTypeChange(next: TripType) {
    setTripType(next);
    setOffers(null);
    if (next === 'MULTI_CITY' && legs.length < MIN_MULTI_CITY_LEGS) {
      setLegs((prev) => [...prev, emptyLeg()]);
    } else if (next !== 'MULTI_CITY') {
      setLegs((prev) => [prev[0] ?? emptyLeg()]);
    }
  }

  function updateLeg(index: number, patch: Partial<FlightLegCriteria>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  function addLeg() {
    setLegs((prev) => (prev.length >= MAX_LEGS ? prev : [...prev, emptyLeg()]));
  }

  function removeLeg(index: number) {
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSearching(true);
    setOffers(null);
    try {
      const searchLegs: FlightLegCriteria[] =
        tripType === 'ROUND_TRIP'
          ? [
              legs[0],
              {
                origin: legs[0].destination,
                destination: legs[0].origin,
                departureDate: returnDate,
              },
            ]
          : legs;

      const results = await apiRequest<FlightOffer[]>('/flights/search', {
        method: 'POST',
        body: {
          tripType,
          legs: searchLegs.map((leg) => ({
            ...leg,
            origin: leg.origin.toUpperCase(),
            destination: leg.destination.toUpperCase(),
          })),
          adults,
          children: children || undefined,
          infants: infants || undefined,
          cabinClass,
        },
      });
      setOffers(results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Flight search failed');
    } finally {
      setSearching(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Book a Flight" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Book a Flight</h2>

        <div className="mt-4 flex max-w-3xl gap-2">
          {TRIP_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => handleTripTypeChange(t.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tripType === t.value
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="mt-3 max-w-3xl space-y-3">
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            {legs.map((leg, index) => (
              <div key={index} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <AirportInput
                    id={`leg-${index}-origin`}
                    label={tripType === 'MULTI_CITY' ? `Flight ${index + 1}: From` : 'From'}
                    placeholder="LOS"
                    value={leg.origin}
                    onChange={(code) => updateLeg(index, { origin: code })}
                    required
                    inputClassName="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none"
                    labelClassName="block text-sm font-medium text-slate-700"
                  />
                </div>
                <div>
                  <AirportInput
                    id={`leg-${index}-destination`}
                    label="To"
                    placeholder="ABV"
                    value={leg.destination}
                    onChange={(code) => updateLeg(index, { destination: code })}
                    required
                    inputClassName="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none"
                    labelClassName="block text-sm font-medium text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Depart</label>
                  <input
                    required
                    type="date"
                    value={leg.departureDate}
                    onChange={(e) => updateLeg(index, { departureDate: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-end">
                  {tripType === 'MULTI_CITY' && legs.length > MIN_MULTI_CITY_LEGS && (
                    <button
                      type="button"
                      onClick={() => removeLeg(index)}
                      className="mb-0.5 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  )}
                  {tripType === 'ROUND_TRIP' && index === 0 && (
                    <div className="w-full">
                      <label className="block text-sm font-medium text-slate-700">Return</label>
                      <input
                        required
                        type="date"
                        value={returnDate}
                        onChange={(e) => setReturnDate(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {tripType === 'MULTI_CITY' && legs.length < MAX_LEGS && (
              <button
                type="button"
                onClick={addLeg}
                className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                + Add another flight
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Adults</label>
              <input
                type="number"
                min={1}
                max={9}
                value={adults}
                onChange={(e) => setAdults(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Children</label>
              <input
                type="number"
                min={0}
                max={9}
                value={children}
                onChange={(e) => setChildren(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Infants</label>
              <input
                type="number"
                min={0}
                max={9}
                value={infants}
                onChange={(e) => setInfants(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Cabin</label>
              <select
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value as CabinClass)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              >
                {CABIN_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={searching}
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Search flights'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {offers && (
          <div className="mt-6 max-w-3xl space-y-3">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
              >
                <div>
                  {offer.legs.map((leg, i) => (
                    <p key={i} className="text-sm text-slate-600">
                      {leg.segments[0].airline} · {leg.segments[0].flightNumber} ·{' '}
                      {leg.origin} → {leg.destination} · {formatDateTime(leg.departureAt)} ·{' '}
                      {formatDuration(leg.segments[0].durationMinutes)}
                    </p>
                  ))}
                  <p className="mt-1 text-sm text-slate-500">
                    {offer.cabinClass.replace('_', ' ')} ·{' '}
                    {offer.tripType === 'ONE_WAY'
                      ? 'One way'
                      : offer.tripType === 'ROUND_TRIP'
                        ? 'Round trip'
                        : 'Multi-city'}
                    {offer.fareConditions && (
                      <>
                        {' · '}
                        <span
                          className={
                            offer.fareConditions.refundable === 'REFUNDABLE'
                              ? 'text-emerald-700'
                              : offer.fareConditions.refundable === 'NON_REFUNDABLE'
                                ? 'text-red-600'
                                : 'text-amber-700'
                          }
                        >
                          {offer.fareConditions.refundable.replace('_', ' ')}
                        </span>
                      </>
                    )}
                  </p>
                  {offer.fareConditions && offer.fareConditions.warnings.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {offer.fareConditions.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-700">
                          ⚠ {w.message}
                          {!w.verified && ' (could not be automatically verified)'}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(offer.totalAmount, offer.currency)}
                  </p>
                  <p className="text-xs text-slate-500">{offer.seatsAvailable} seats left</p>
                  <button
                    onClick={() => router.push(`/portal/flights/book/${offer.id}`)}
                    className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Select
                  </button>
                </div>
              </div>
            ))}
            {offers.length === 0 && (
              <p className="text-sm text-slate-500">No flights found for that search.</p>
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}

export default function FlightSearchPage() {
  return (
    <Suspense fallback={null}>
      <FlightSearchForm />
    </Suspense>
  );
}
