'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { FlightBooking } from '@/lib/types';

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
};

export default function MyFlightBookingsPage() {
  const [bookings, setBookings] = useState<FlightBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<FlightBooking[]>('/flights/bookings/me')
      .then(setBookings)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="My Bookings" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">My Flight Bookings</h2>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Reference</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Route</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Depart</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Total</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings?.map((booking) => (
                <tr key={booking.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {booking.bookingReference}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {booking.origin} → {booking.destination}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatDateTime(booking.departureAt)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatCurrency(booking.totalAmount, booking.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[booking.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {booking.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/portal/flights/${booking.id}`}
                      className="font-medium text-slate-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {bookings?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No bookings yet.{' '}
                    <Link href="/portal/flights/search" className="underline">
                      Search flights
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
