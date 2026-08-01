'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, formatDuration } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { CabinClass, FlightOffer } from '@/lib/types';

const CABIN_CLASSES: CabinClass[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

export default function FlightSearchPage() {
  const router = useRouter();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabinClass, setCabinClass] = useState<CabinClass>('ECONOMY');

  const [offers, setOffers] = useState<FlightOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSearching(true);
    setOffers(null);
    try {
      const params = new URLSearchParams({
        origin,
        destination,
        departureDate,
        adults: String(adults),
        cabinClass,
      });
      if (returnDate) params.set('returnDate', returnDate);
      if (children) params.set('children', String(children));
      if (infants) params.set('infants', String(infants));

      const results = await apiRequest<FlightOffer[]>(`/flights/search?${params.toString()}`);
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

        <form
          onSubmit={handleSearch}
          className="mt-4 grid max-w-3xl grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">From</label>
            <input
              required
              maxLength={3}
              placeholder="LOS"
              value={origin}
              onChange={(e) => setOrigin(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">To</label>
            <input
              required
              maxLength={3}
              placeholder="ABV"
              value={destination}
              onChange={(e) => setDestination(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Depart</label>
            <input
              required
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Return (optional)</label>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
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

          <button
            type="submit"
            disabled={searching}
            className="col-span-2 w-fit self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-4"
          >
            {searching ? 'Searching…' : 'Search flights'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {offers && (
          <div className="mt-6 space-y-3">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {offer.outboundSegments[0].airline} · {offer.outboundSegments[0].flightNumber}
                  </p>
                  <p className="text-sm text-slate-600">
                    {offer.origin} → {offer.destination} · {formatDateTime(offer.departureAt)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {formatDuration(offer.outboundSegments[0].durationMinutes)} ·{' '}
                    {offer.cabinClass.replace('_', ' ')}
                    {offer.returnSegments ? ' · Round trip' : ' · One way'}
                  </p>
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
