'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { HotelBooking, HotelBookingStatus } from '@/lib/types';

const STATUSES: Array<HotelBookingStatus | ''> = ['', 'PENDING', 'CONFIRMED', 'CANCELLED'];

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700',
};

export default function AdminHotelBookingsPage() {
  const [bookings, setBookings] = useState<HotelBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HotelBookingStatus | ''>('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<HotelBooking[]>(`/hotels/bookings?${params.toString()}`)
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [statusFilter]);

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await apiRequest(`/hotels/bookings/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Hotel Bookings" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Hotel Bookings</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as HotelBookingStatus | '')}
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
                <th className="px-4 py-2 text-left font-medium text-slate-600">Hotel</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Dates</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Total</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings?.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{b.bookingReference}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {b.customer ? `${b.customer.firstName} ${b.customer.lastName}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {b.hotelName}, {b.city}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatDateTime(b.checkInDate)} → {formatDateTime(b.checkOutDate)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatCurrency(b.totalAmount, b.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[b.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {b.status === 'CONFIRMED' && (
                      <button
                        onClick={() => handleCancel(b.id)}
                        disabled={cancellingId === b.id}
                        className="font-medium text-slate-700 hover:underline disabled:opacity-50"
                      >
                        {cancellingId === b.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
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
