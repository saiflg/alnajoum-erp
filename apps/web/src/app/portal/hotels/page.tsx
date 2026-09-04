'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { CustomerProfile, HotelBooking, HotelOffer } from '@/lib/types';

interface RefundPreview {
  estimatedRefundAmount: number;
  estimatedSupplierPenalty: number;
  agencyFee: number;
  currency: string;
}

export default function PortalHotelsPage() {
  const [city, setCity] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState(2);

  const [offers, setOffers] = useState<HotelOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bookings, setBookings] = useState<HotelBooking[] | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  // Guest-selection step: which offer (if any) is expanded for booking, and
  // who's staying — mirrors the flight booking flow's passenger picker.
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [selfIncluded, setSelfIncluded] = useState(true);
  const [familySelections, setFamilySelections] = useState<Record<string, boolean>>({});
  const [bookingOfferId, setBookingOfferId] = useState<string | null>(null);

  const [refundPreviews, setRefundPreviews] = useState<Record<string, RefundPreview>>({});
  const [requestingRefundId, setRequestingRefundId] = useState<string | null>(null);

  function loadBookings() {
    apiRequest<HotelBooking[]>('/hotels/bookings/me')
      .then(setBookings)
      .catch(() => undefined);
  }

  useEffect(loadBookings, []);
  useEffect(() => {
    apiRequest<CustomerProfile>('/customers/me').then(setProfile).catch(() => undefined);
  }, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSearching(true);
    setOffers(null);
    setSelectingOfferId(null);
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

  function startSelectingGuests(offerId: string) {
    setSelectingOfferId(offerId);
    setSelfIncluded(true);
    const initial: Record<string, boolean> = {};
    for (const member of profile?.familyMembers ?? []) initial[member.id] = false;
    setFamilySelections(initial);
  }

  async function handleBook(offer: HotelOffer) {
    setError(null);
    const guestList = [
      ...(selfIncluded && profile ? [{ firstName: profile.firstName, lastName: profile.lastName }] : []),
      ...Object.entries(familySelections)
        .filter(([, included]) => included)
        .map(([familyMemberId]) => {
          const member = profile?.familyMembers?.find((m) => m.id === familyMemberId);
          return { firstName: member?.firstName ?? '', lastName: member?.lastName ?? '', familyMemberId };
        }),
    ];
    if (guestList.length === 0) {
      setError('Select at least one guest.');
      return;
    }

    setBookingOfferId(offer.id);
    try {
      await apiRequest('/hotels/bookings/me', {
        method: 'POST',
        body: {
          offerId: offer.id,
          guests: guestList,
          idempotencyKey: `${offer.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      });
      setOffers(null);
      setSelectingOfferId(null);
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

  async function loadRefundPreview(id: string) {
    try {
      const preview = await apiRequest<RefundPreview>(`/hotels/bookings/me/${id}/refund-preview`);
      setRefundPreviews((prev) => ({ ...prev, [id]: preview }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load refund estimate');
    }
  }

  async function handleRequestRefund(id: string) {
    const preview = refundPreviews[id];
    if (!preview) return;
    if (!confirm(`Request a refund of approximately ${formatCurrency(preview.estimatedRefundAmount, preview.currency)}?`)) return;
    setRequestingRefundId(id);
    try {
      await apiRequest(`/hotels/bookings/me/${id}/refund-request`, { method: 'POST', body: {} });
      setRefundPreviews((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      loadBookings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request refund');
    } finally {
      setRequestingRefundId(null);
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
              <div key={offer.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {offer.hotelName} · {'★'.repeat(offer.starRating)}
                      {offer.provider === 'CATALOG' && (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Alnajoum managed
                        </span>
                      )}
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
                      onClick={() =>
                        selectingOfferId === offer.id ? setSelectingOfferId(null) : startSelectingGuests(offer.id)
                      }
                      className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      {selectingOfferId === offer.id ? 'Cancel' : 'Book'}
                    </button>
                  </div>
                </div>

                {selectingOfferId === offer.id && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <h4 className="text-xs font-semibold text-slate-700">Who&apos;s staying?</h4>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={selfIncluded}
                          onChange={(e) => setSelfIncluded(e.target.checked)}
                        />
                        Myself {profile ? `(${profile.firstName} ${profile.lastName})` : ''}
                      </label>
                      {profile?.familyMembers?.map((member) => (
                        <label key={member.id} className="flex items-center gap-2 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            checked={familySelections[member.id] ?? false}
                            onChange={(e) =>
                              setFamilySelections((prev) => ({ ...prev, [member.id]: e.target.checked }))
                            }
                          />
                          {member.firstName} {member.lastName}{' '}
                          <span className="text-slate-500">({member.relationship})</span>
                        </label>
                      ))}
                      {(!profile?.familyMembers || profile.familyMembers.length === 0) && (
                        <p className="text-xs text-slate-500">
                          No family members on file — add them from the Family Members page to book for them too.
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleBook(offer)}
                      disabled={bookingOfferId === offer.id}
                      className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {bookingOfferId === offer.id ? 'Booking…' : 'Confirm booking'}
                    </button>
                  </div>
                )}
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
            <div key={b.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
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
                    className={`text-xs ${
                      b.status === 'CANCELLED'
                        ? 'text-red-600'
                        : b.status === 'REFUNDED'
                          ? 'text-purple-600'
                          : b.status === 'COMPLETED'
                            ? 'text-blue-600'
                            : 'text-emerald-600'
                    }`}
                  >
                    {b.status.replace(/_/g, ' ')}
                  </p>
                  {b.status === 'CONFIRMED' && (
                    <button
                      onClick={() => handleCancel(b.id)}
                      className="mt-1 text-xs text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                  )}
                  {b.status === 'COMPLETED' && !refundPreviews[b.id] && (
                    <button
                      onClick={() => loadRefundPreview(b.id)}
                      className="mt-1 text-xs text-slate-500 hover:underline"
                    >
                      Request refund
                    </button>
                  )}
                </div>
              </div>

              {refundPreviews[b.id] && (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  <p>
                    Estimated refund: {formatCurrency(refundPreviews[b.id].estimatedRefundAmount, refundPreviews[b.id].currency)}{' '}
                    (booking price minus any supplier penalty and our processing fee). Final amount confirmed once
                    processed.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleRequestRefund(b.id)}
                      disabled={requestingRefundId === b.id}
                      className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {requestingRefundId === b.id ? 'Submitting…' : 'Confirm refund request'}
                    </button>
                    <button
                      onClick={() =>
                        setRefundPreviews((prev) => {
                          const next = { ...prev };
                          delete next[b.id];
                          return next;
                        })
                      }
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
