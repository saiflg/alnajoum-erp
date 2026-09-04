'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { FlightBooking, RefundPreview } from '@/lib/types';

export default function AdminFlightBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const [booking, setBooking] = useState<FlightBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [ticketing, setTicketing] = useState(false);
  const [refundPreview, setRefundPreview] = useState<RefundPreview | null>(null);
  const [refunding, setRefunding] = useState(false);

  const canCancel = !!user?.permissions.includes('flight:cancel');
  const canTicket = !!user?.permissions.includes('flight:ticket_issue');
  const canRefund = !!user?.permissions.includes('flight:refund');

  function load() {
    apiRequest<FlightBooking>(`/flights/bookings/${params.id}`)
      .then(setBooking)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [params.id]);

  async function handleCancel() {
    if (!confirm('Cancel this booking?')) return;
    setCancelling(true);
    try {
      await apiRequest(`/flights/bookings/${params.id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel booking');
    } finally {
      setCancelling(false);
    }
  }

  async function handleIssueTicket() {
    if (!confirm('Issue the ticket for this booking? This confirms the ticket with the provider.')) return;
    setTicketing(true);
    try {
      await apiRequest(`/flights/bookings/${params.id}/ticket`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to issue ticket');
    } finally {
      setTicketing(false);
    }
  }

  async function loadRefundPreview() {
    try {
      const preview = await apiRequest<RefundPreview>(`/flights/bookings/${params.id}/refund-preview`);
      setRefundPreview(preview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load refund preview');
    }
  }

  async function handleRefund() {
    if (!refundPreview) return;
    if (
      !confirm(
        `Refund ${formatCurrency(refundPreview.estimatedRefundAmount, refundPreview.currency)} to the customer? (Provider penalty ${formatCurrency(refundPreview.estimatedProviderPenalty, refundPreview.currency)}, agency fee ${formatCurrency(refundPreview.agencyFee, refundPreview.currency)})`,
      )
    )
      return;
    setRefunding(true);
    try {
      await apiRequest(`/flights/bookings/${params.id}/refund`, { method: 'POST', body: {} });
      setRefundPreview(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process refund');
    } finally {
      setRefunding(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Booking Detail" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {booking && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {booking.bookingReference}
              </h2>
              <div className="flex gap-2">
                {canTicket && booking.status === 'CONFIRMED' && (
                  <button
                    onClick={handleIssueTicket}
                    disabled={ticketing}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {ticketing ? 'Issuing…' : 'Issue ticket'}
                  </button>
                )}
                {canRefund && booking.status === 'TICKETED' && !refundPreview && (
                  <button
                    onClick={loadRefundPreview}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Preview refund
                  </button>
                )}
                {canCancel && (booking.status === 'PENDING' || booking.status === 'CONFIRMED') && (
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
            {booking.customer && (
              <p className="text-sm text-slate-500">
                {booking.customer.firstName} {booking.customer.lastName}
              </p>
            )}

            {refundPreview && (
              <div className="mt-4 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Refund preview</p>
                <p className="mt-1 text-sm text-amber-800">
                  Ticket price {formatCurrency(refundPreview.ticketPrice, refundPreview.currency)} − provider
                  penalty {formatCurrency(refundPreview.estimatedProviderPenalty, refundPreview.currency)} − agency
                  fee {formatCurrency(refundPreview.agencyFee, refundPreview.currency)} ={' '}
                  <strong>{formatCurrency(refundPreview.estimatedRefundAmount, refundPreview.currency)}</strong>{' '}
                  estimated refund
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleRefund}
                    disabled={refunding}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {refunding ? 'Processing…' : 'Confirm refund'}
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
              {booking.providerCost !== null && (
                <p className="text-xs text-slate-500">
                  Provider cost {formatCurrency(booking.providerCost, booking.currency)} + markup{' '}
                  {formatCurrency(booking.markupAmount ?? 0, booking.currency)}
                </p>
              )}
              <p className="text-sm text-slate-500">Status: {booking.status.replace('_', ' ')}</p>
              {booking.pnr && <p className="text-sm text-slate-500">PNR: {booking.pnr}</p>}
              {booking.bookedByStaffId && (
                <p className="text-sm text-slate-500">
                  Booked by a staff member on the customer&apos;s behalf
                </p>
              )}

              {booking.fareRules && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-500">
                    {booking.fareRules.refundable.replace('_', ' ')}
                    {booking.fareRules.fareBrand ? ` · ${booking.fareRules.fareBrand}` : ''}
                  </p>
                  {booking.fareRules.cancellationPenaltyDescription && (
                    <p className="mt-1 text-xs text-slate-500">
                      {booking.fareRules.cancellationPenaltyDescription}
                    </p>
                  )}
                </div>
              )}

              {booking.providerWarnings && booking.providerWarnings.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-amber-100 pt-3">
                  {booking.providerWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      ⚠ {w.message}
                      {!w.verified && ' (could not be automatically verified)'}
                    </p>
                  ))}
                </div>
              )}
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
