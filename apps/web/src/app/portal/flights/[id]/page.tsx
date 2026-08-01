'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { FlightBooking } from '@/lib/types';

export default function FlightBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const [booking, setBooking] = useState<FlightBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    apiRequest<FlightBooking>(`/flights/bookings/me/${params.id}`)
      .then(setBooking)
      .catch((err) => setError(err instanceof ApiError ? err.message : err.message));
  }

  useEffect(load, [params.id]);

  async function handleCancel() {
    if (!confirm('Cancel this booking?')) return;
    setCancelling(true);
    try {
      await apiRequest(`/flights/bookings/me/${params.id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel booking');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Booking Detail" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {booking && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {booking.bookingReference}
              </h2>
              {booking.status === 'CONFIRMED' && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel booking'}
                </button>
              )}
            </div>

            <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-medium text-slate-900">
                {booking.origin} → {booking.destination}
              </p>
              <p className="text-sm text-slate-600">
                Depart: {formatDateTime(booking.departureAt)}
              </p>
              {booking.returnAt && (
                <p className="text-sm text-slate-600">
                  Return: {formatDateTime(booking.returnAt)}
                </p>
              )}
              <p className="text-sm text-slate-600">
                Cabin: {booking.cabinClass.replace('_', ' ')}
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {formatCurrency(booking.totalAmount, booking.currency)}
              </p>
              <p className="text-sm text-slate-500">Status: {booking.status}</p>
            </div>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Passengers</h3>
            <div className="mt-2 max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {booking.passengers.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-slate-700">
                        {p.firstName} {p.lastName}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{p.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
