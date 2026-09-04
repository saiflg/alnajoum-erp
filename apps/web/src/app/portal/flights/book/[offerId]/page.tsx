'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, formatDuration } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { CustomerProfile, FlightOffer, PassengerType } from '@/lib/types';

const PASSENGER_TYPES: PassengerType[] = ['ADULT', 'CHILD', 'INFANT'];

export default function BookFlightPage() {
  const params = useParams<{ offerId: string }>();
  const router = useRouter();

  const [offer, setOffer] = useState<FlightOffer | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [selfIncluded, setSelfIncluded] = useState(true);
  const [selfType, setSelfType] = useState<PassengerType>('ADULT');
  const [familySelections, setFamilySelections] = useState<
    Record<string, { included: boolean; type: PassengerType }>
  >({});

  useEffect(() => {
    apiRequest<FlightOffer>(`/flights/offers/${params.offerId}`)
      .then(setOffer)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load offer'));

    apiRequest<CustomerProfile>('/customers/me')
      .then((data) => {
        setProfile(data);
        const initial: Record<string, { included: boolean; type: PassengerType }> = {};
        for (const member of data.familyMembers ?? []) {
          initial[member.id] = { included: false, type: 'ADULT' };
        }
        setFamilySelections(initial);
      })
      .catch(() => undefined);
  }, [params.offerId]);

  const [priceChangeNotice, setPriceChangeNotice] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => `${params.offerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  async function handleConfirm() {
    setError(null);
    setPriceChangeNotice(null);
    const passengers = [
      ...(selfIncluded ? [{ type: selfType }] : []),
      ...Object.entries(familySelections)
        .filter(([, v]) => v.included)
        .map(([familyMemberId, v]) => ({ type: v.type, familyMemberId })),
    ];

    if (passengers.length === 0) {
      setError('Select at least one passenger.');
      return;
    }
    if (!offer) return;

    setSubmitting(true);
    try {
      // Never trust the price shown on this page without re-checking it
      // first — prices can move between search and the moment you press
      // confirm (spec #6).
      const revalidation = await apiRequest<{
        offer: FlightOffer;
        priceChanged: boolean;
        currentAmount: number;
      }>(`/flights/offers/${params.offerId}/revalidate?previousAmount=${offer.totalAmount}`);

      if (revalidation.priceChanged) {
        setOffer(revalidation.offer);
        setPriceChangeNotice(
          `The price for this flight has changed to ${formatCurrency(revalidation.currentAmount, revalidation.offer.currency)}. Please review and confirm again.`,
        );
        setSubmitting(false);
        return;
      }

      const booking = await apiRequest<{ id: string }>('/flights/bookings/me', {
        method: 'POST',
        body: {
          offerId: params.offerId,
          passengers,
          expectedPrice: offer.totalAmount,
          idempotencyKey,
        },
      });
      router.push(`/portal/flights/${booking.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create booking');
      setSubmitting(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Confirm Booking" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Confirm Your Booking</h2>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {priceChangeNotice && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {priceChangeNotice}
          </p>
        )}

        {offer && (
          <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
            {offer.legs.map((leg, i) => (
              <p key={i} className="text-sm text-slate-700">
                {i === 0 ? '' : i === offer.legs.length - 1 && offer.tripType === 'ROUND_TRIP' ? 'Return: ' : `Flight ${i + 1}: `}
                {leg.segments[0].airline} · {leg.segments[0].flightNumber} · {leg.origin} →{' '}
                {leg.destination} · {formatDateTime(leg.departureAt)} ·{' '}
                {formatDuration(leg.segments[0].durationMinutes)}
              </p>
            ))}
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {formatCurrency(offer.totalAmount, offer.currency)}{' '}
              <span className="text-sm font-normal text-slate-500">total</span>
            </p>

            {offer.fareConditions && (
              <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <p className="font-medium text-slate-700">
                  {offer.fareConditions.refundable.replace('_', ' ')}
                  {offer.fareConditions.fareBrand ? ` · ${offer.fareConditions.fareBrand}` : ''}
                </p>
                {offer.fareConditions.cancellationPenaltyDescription && (
                  <p className="mt-1">{offer.fareConditions.cancellationPenaltyDescription}</p>
                )}
                {offer.fareConditions.baggageAllowance && (
                  <p className="mt-1">
                    Baggage: {offer.fareConditions.baggageAllowance.checked ?? '—'} checked,{' '}
                    {offer.fareConditions.baggageAllowance.cabin ?? '—'} cabin
                  </p>
                )}
                {offer.fareConditions.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {offer.fareConditions.warnings.map((w, i) => (
                      <p key={i} className="text-amber-700">
                        ⚠ {w.message}
                        {!w.verified && ' (could not be automatically verified)'}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Passengers</h3>

          <div className="mt-3 flex items-center gap-3">
            <input
              type="checkbox"
              checked={selfIncluded}
              onChange={(e) => setSelfIncluded(e.target.checked)}
              id="self-passenger"
            />
            <label htmlFor="self-passenger" className="flex-1 text-sm text-slate-800">
              Myself {profile ? `(${profile.firstName} ${profile.lastName})` : ''}
            </label>
            <select
              disabled={!selfIncluded}
              value={selfType}
              onChange={(e) => setSelfType(e.target.value as PassengerType)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
            >
              {PASSENGER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {profile?.familyMembers?.map((member) => (
            <div key={member.id} className="mt-3 flex items-center gap-3">
              <input
                type="checkbox"
                checked={familySelections[member.id]?.included ?? false}
                onChange={(e) =>
                  setFamilySelections((prev) => ({
                    ...prev,
                    [member.id]: { ...prev[member.id], included: e.target.checked },
                  }))
                }
                id={`member-${member.id}`}
              />
              <label htmlFor={`member-${member.id}`} className="flex-1 text-sm text-slate-800">
                {member.firstName} {member.lastName}{' '}
                <span className="text-slate-500">({member.relationship})</span>
              </label>
              <select
                disabled={!familySelections[member.id]?.included}
                value={familySelections[member.id]?.type ?? 'ADULT'}
                onChange={(e) =>
                  setFamilySelections((prev) => ({
                    ...prev,
                    [member.id]: {
                      ...prev[member.id],
                      type: e.target.value as PassengerType,
                    },
                  }))
                }
                className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
              >
                {PASSENGER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {(!profile?.familyMembers || profile.familyMembers.length === 0) && (
            <p className="mt-3 text-sm text-slate-500">
              No family members on file. Add them from the Family Members page to book for them
              too.
            </p>
          )}

          <button
            onClick={handleConfirm}
            disabled={submitting || !offer}
            className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
