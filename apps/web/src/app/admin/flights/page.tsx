'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { FlightBooking, FlightBookingStatus } from '@/lib/types';

const STATUSES: Array<FlightBookingStatus | ''> = ['', 'PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED'];

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
};

export default function AdminFlightBookingsPage() {
  const [bookings, setBookings] = useState<FlightBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FlightBookingStatus | ''>('');

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<FlightBooking[]>(`/flights/bookings?${params.toString()}`)
      .then(setBookings)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [statusFilter]);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Flight Bookings" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Flight Bookings</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FlightBookingStatus | '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All statuses'}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Reference</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Customer</th>
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
                    {booking.customer
                      ? `${booking.customer.firstName} ${booking.customer.lastName}`
                      : '—'}
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
                      href={`/admin/flights/${booking.id}`}
                      className="font-medium text-slate-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {bookings?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={7}>
                    No bookings found.
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
