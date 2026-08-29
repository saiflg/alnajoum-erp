'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { HotelBooking, HotelOffer } from '@/lib/types';

export default function PortalHotelsPage() {
  const [city, setCity] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState(2);

  const [offers, setOffers] = useState<HotelOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [bookingOfferId, setBookingOfferId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bookings, setBookings] = useState<HotelBooking[] | null>(null);

  function loadBookings() {
    apiRequest<HotelBooking[]>('/hotels/bookings/me')
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
      const results = await apiRequest<HotelOffer[]>('/hotels/search', {
        method: 'POST',
        body: { city, checkInDate, checkOutDate, rooms, guests },
      });
      setOffers(results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hotel search failed');
    } finally {
      setSearching(false);
    }
  }

  async function handleBook(offerId: string) {
    setError(null);
    setBookingOfferId(offerId);
    try {
      await apiRequest('/hotels/bookings/me', { method: 'POST', body: { offerId } });
      setOffers(null);
      loadBookings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to book this hotel');
    } finally {
      setBookingOfferId(null);
    }
  }

  async function handleCancel(id: string) {
    try {
      await apiRequest(`/hotels/bookings/me/${id}/cancel`, { method: 'POST' });
      loadBookings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel this booking');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Hotels" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Book a Hotel</h2>
        <p className="mt-1 text-sm text-slate-500">
          Search by city, dates, and guest count — every confirmed booking generates a
          matching invoice automatically, same as flights.
        </p>

        <form onSubmit={handleSearch} className="mt-4 max-w-3xl space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">City</label>
              <input
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Lagos"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Check-in</label>
              <input
                required
                type="date"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Check-out</label>
              <input
                required
                type="date"
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-1">
              <div>
                <label className="block text-sm font-medium text-slate-700">Rooms</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={rooms}
                  onChange={(e) => setRooms(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Guests</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={guests}
                  onChange={(e) => setGuests(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={searching}
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Search hotels'}
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
                  <p className="text-sm font-semibold text-slate-900">
                    {offer.hotelName} · {'★'.repeat(offer.starRating)}
                  </p>
                  <p className="text-sm text-slate-600">
                    {offer.roomType} · {offer.city}, {offer.country}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {offer.checkInDate} → {offer.checkOutDate} · {offer.rooms} room(s),{' '}
                    {offer.guests} guest(s)
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{offer.amenities.join(' · ')}</p>
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
              <p className="text-sm text-slate-500">No hotels found for that search.</p>
            )}
          </div>
        )}

        <h3 className="mt-10 text-sm font-semibold text-slate-900">My Hotel Bookings</h3>
        <div className="mt-3 max-w-3xl space-y-2">
          {bookings?.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {b.hotelName} <span className="text-slate-400">({b.bookingReference})</span>
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(b.checkInDate)} → {formatDateTime(b.checkOutDate)} ·{' '}
                  {b.city}
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
            <p className="text-sm text-slate-500">No hotel bookings yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
