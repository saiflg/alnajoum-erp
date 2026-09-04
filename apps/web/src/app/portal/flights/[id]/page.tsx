'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { FlightBooking, RefundPreview } from '@/lib/types';

export default function FlightBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const [booking, setBooking] = useState<FlightBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [refundPreview, setRefundPreview] = useState<RefundPreview | null>(null);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundRequested, setRefundRequested] = useState(false);

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

  async function loadRefundPreview() {
    try {
      const preview = await apiRequest<RefundPreview>(`/flights/bookings/me/${params.id}/refund-preview`);
      setRefundPreview(preview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load refund estimate');
    }
  }

  async function handleRequestRefund() {
    if (!refundPreview) return;
    if (
      !confirm(
        `Request a refund of approximately ${formatCurrency(refundPreview.estimatedRefundAmount, refundPreview.currency)}?`,
      )
    )
      return;
    setRequestingRefund(true);
    try {
      await apiRequest(`/flights/bookings/me/${params.id}/refund-request`, { method: 'POST', body: {} });
      setRefundRequested(true);
      setRefundPreview(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request refund');
    } finally {
      setRequestingRefund(false);
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
              <div className="flex gap-2">
                {booking.status === 'TICKETED' && !refundPreview && !refundRequested && (
                  <button
                    onClick={loadRefundPreview}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Request refund
                  </button>
                )}
                {(booking.status === 'PENDING' || booking.status === 'CONFIRMED') && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel booking'}
                  </button>
                )}
              </div>
            </div>

            {refundPreview && (
              <div className="mt-4 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm text-amber-800">
                  Based on this ticket&apos;s fare rules, you would receive approximately{' '}
                  <strong>{formatCurrency(refundPreview.estimatedRefundAmount, refundPreview.currency)}</strong>{' '}
                  back (ticket price minus airline penalty and our processing fee). The final amount is confirmed
                  once the airline processes the cancellation.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleRequestRefund}
                    disabled={requestingRefund}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {requestingRefund ? 'Submitting…' : 'Confirm refund request'}
                  </button>
                  <button
                    onClick={() => setRefundPreview(null)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {refundRequested && (
              <p className="mt-4 text-sm text-emerald-700">
                Your refund request has been submitted and is being processed.
              </p>
            )}

            <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
              {booking.itinerary.legs.map((leg, i) => (
                <p key={i} className="text-sm text-slate-700">
                  {i === 0
                    ? ''
                    : i === booking.itinerary.legs.length - 1 &&
                        booking.tripType === 'ROUND_TRIP'
                      ? 'Return: '
                      : `Flight ${i + 1}: `}
                  {leg.segments[0].airline} · {leg.segments[0].flightNumber} · {leg.origin} →{' '}
                  {leg.destination} · {formatDateTime(leg.departureAt)}
                </p>
              ))}
              <p className="mt-2 text-sm text-slate-600">
                Cabin: {booking.cabinClass.replace('_', ' ')}
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {formatCurrency(booking.totalAmount, booking.currency)}
              </p>
              <p className="text-sm text-slate-500">Status: {booking.status.replace('_', ' ')}</p>
              {booking.pnr && <p className="text-sm text-slate-500">PNR: {booking.pnr}</p>}
            </div>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Passengers</h3>
            <div className="mt-2 max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Ticket #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {booking.passengers.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-slate-700">
                        {p.firstName} {p.lastName}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{p.type}</td>
                      <td className="px-4 py-2 text-slate-600">{p.ticketNumber ?? '—'}</td>
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
