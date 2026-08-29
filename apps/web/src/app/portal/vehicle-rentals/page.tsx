'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { VehicleRental, VehicleRentalOffer, VehicleType } from '@/lib/types';

const VEHICLE_TYPES: Array<{ value: VehicleType; label: string }> = [
  { value: 'CAR', label: 'Car' },
  { value: 'VAN', label: 'Van' },
  { value: 'BUS', label: 'Bus' },
];

export default function PortalVehicleRentalsPage() {
  const [vehicleType, setVehicleType] = useState<VehicleType>('CAR');
  const [pickupCity, setPickupCity] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [dropoffAt, setDropoffAt] = useState('');
  const [withDriver, setWithDriver] = useState(true);

  const [offers, setOffers] = useState<VehicleRentalOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [bookingOfferId, setBookingOfferId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bookings, setBookings] = useState<VehicleRental[] | null>(null);

  function loadBookings() {
    apiRequest<VehicleRental[]>('/vehicle-rentals/bookings/me')
      .then(setBookings)
      .catch(() => undefined);
  }

  useEffect(loadBookings, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSearching(true);
    setOffers(null);
    try {
      const results = await apiRequest<VehicleRentalOffer[]>('/vehicle-rentals/search', {
        method: 'POST',
        body: { vehicleType, pickupCity, pickupAt, dropoffAt, withDriver },
      });
      setOffers(results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vehicle search failed');
    } finally {
      setSearching(false);
    }
  }

  async function handleBook(offerId: string) {
    setError(null);
    setBookingOfferId(offerId);
    try {
      await apiRequest('/vehicle-rentals/bookings/me', { method: 'POST', body: { offerId } });
      setOffers(null);
      loadBookings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to book this vehicle');
    } finally {
      setBookingOfferId(null);
    }
  }

  async function handleCancel(id: string) {
    try {
      await apiRequest(`/vehicle-rentals/bookings/me/${id}/cancel`, { method: 'POST' });
      loadBookings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel this booking');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Car, Van & Bus Rental" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Rent a Vehicle</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cars, vans, and buses, with or without a driver — the same real invoicing flow
          as flights and hotels.
        </p>

        <form onSubmit={handleSearch} className="mt-4 max-w-3xl space-y-3">
          <div className="flex gap-2">
            {VEHICLE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setVehicleType(t.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  vehicleType === t.value
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Pickup city</label>
              <input
                required
                value={pickupCity}
                onChange={(e) => setPickupCity(e.target.value)}
                placeholder="Lagos"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Pickup</label>
              <input
                required
                type="datetime-local"
                value={pickupAt}
                onChange={(e) => setPickupAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Drop-off</label>
              <input
                required
                type="datetime-local"
                value={dropoffAt}
                onChange={(e) => setDropoffAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={withDriver}
                  onChange={(e) => setWithDriver(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                With driver
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={searching}
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Search vehicles'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {offers && (
          <div className="mt-6 max-w-3xl space-y-3">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{offer.vehicleName}</p>
                  <p className="text-sm text-slate-600">
                    {offer.seats} seats · {offer.withDriver ? 'With driver' : 'Self-drive'} ·{' '}
                    {offer.pickupCity}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{offer.features.join(' · ')}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(offer.totalAmount, offer.currency)}
                  </p>
                  <button
                    onClick={() => handleBook(offer.id)}
                    disabled={bookingOfferId === offer.id}
                    className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {bookingOfferId === offer.id ? 'Booking…' : 'Book'}
                  </button>
                </div>
              </div>
            ))}
            {offers.length === 0 && (
              <p className="text-sm text-slate-500">No vehicles found for that search.</p>
            )}
          </div>
        )}

        <h3 className="mt-10 text-sm font-semibold text-slate-900">My Vehicle Rentals</h3>
        <div className="mt-3 max-w-3xl space-y-2">
          {bookings?.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {b.vehicleName} <span className="text-slate-400">({b.bookingReference})</span>
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(b.pickupAt)} → {formatDateTime(b.dropoffAt)} · {b.pickupCity}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">
                  {formatCurrency(b.totalAmount, b.currency)}
                </p>
                <p
                  className={`text-xs ${b.status === 'CANCELLED' ? 'text-red-600' : 'text-emerald-600'}`}
                >
                  {b.status}
                </p>
                {b.status === 'CONFIRMED' && (
                  <button
                    onClick={() => handleCancel(b.id)}
                    className="mt-1 text-xs text-slate-500 hover:underline"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
          {bookings?.length === 0 && (
            <p className="text-sm text-slate-500">No vehicle rentals yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
