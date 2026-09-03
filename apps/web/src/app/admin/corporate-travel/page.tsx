'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { CorporateAccount, CorporateBooking, CorporateTraveler } from '@/lib/types';

const BOOKING_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

function NewAccountForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [contactPersonName, setContactPersonName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [billingPhone, setBillingPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/corporate-travel/accounts', {
        method: 'POST',
        body: {
          name,
          contactPersonName: contactPersonName || undefined,
          billingEmail: billingEmail || undefined,
          billingPhone: billingPhone || undefined,
        },
      });
      setName('');
      setContactPersonName('');
      setBillingEmail('');
      setBillingPhone('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
    >
      <input
        required
        placeholder="Company name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-1"
      />
      <input
        placeholder="Contact person"
        value={contactPersonName}
        onChange={(e) => setContactPersonName(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Billing email"
        value={billingEmail}
        onChange={(e) => setBillingEmail(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Billing phone"
        value={billingPhone}
        onChange={(e) => setBillingPhone(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="col-span-2 text-sm text-red-600 sm:col-span-4">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-4"
      >
        {submitting ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}

function AccountDetail({ accountId }: { accountId: string }) {
  const [travelers, setTravelers] = useState<CorporateTraveler[] | null>(null);
  const [bookings, setBookings] = useState<CorporateBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [department, setDepartment] = useState('');
  const [addingTraveler, setAddingTraveler] = useState(false);

  const [bookingDescription, setBookingDescription] = useState('');
  const [selectedTravelers, setSelectedTravelers] = useState<Record<string, string>>({});
  const [creatingBooking, setCreatingBooking] = useState(false);

  function load() {
    apiRequest<CorporateTraveler[]>(`/corporate-travel/accounts/${accountId}/travelers`)
      .then(setTravelers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load travelers'));
    apiRequest<CorporateBooking[]>(`/corporate-travel/bookings?corporateAccountId=${accountId}`)
      .then(setBookings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load bookings'));
  }

  useEffect(load, [accountId]);

  async function handleAddTraveler(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAddingTraveler(true);
    try {
      await apiRequest(`/corporate-travel/accounts/${accountId}/travelers`, {
        method: 'POST',
        body: { firstName, lastName, department: department || undefined },
      });
      setFirstName('');
      setLastName('');
      setDepartment('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add traveler');
    } finally {
      setAddingTraveler(false);
    }
  }

  function setTravelerAmount(travelerId: string, amount: string) {
    setSelectedTravelers((prev) => ({ ...prev, [travelerId]: amount }));
  }

  async function handleCreateBooking(e: FormEvent) {
    e.preventDefault();
    const entries = Object.entries(selectedTravelers).filter(([, amount]) => amount && Number(amount) > 0);
    if (entries.length === 0) {
      setError('Enter an amount for at least one traveler');
      return;
    }
    setError(null);
    setCreatingBooking(true);
    try {
      await apiRequest(`/corporate-travel/accounts/${accountId}/bookings`, {
        method: 'POST',
        body: {
          description: bookingDescription,
          travelers: entries.map(([travelerId, amount]) => ({
            travelerId,
            description: bookingDescription,
            amount: Number(amount),
          })),
        },
      });
      setBookingDescription('');
      setSelectedTravelers({});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create booking');
    } finally {
      setCreatingBooking(false);
    }
  }

  async function handleCancelBooking(id: string) {
    setError(null);
    try {
      await apiRequest(`/corporate-travel/bookings/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel booking');
    }
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <p className="text-sm font-semibold text-slate-700">Traveler roster</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {travelers?.map((t) => (
          <span key={t.id} className="rounded-full bg-white border border-slate-200 px-3 py-1 text-xs text-slate-700">
            {t.firstName} {t.lastName}
            {t.department ? ` · ${t.department}` : ''}
          </span>
        ))}
        {travelers?.length === 0 && <p className="text-xs text-slate-500">No travelers added yet.</p>}
      </div>
      <form onSubmit={handleAddTraveler} className="mt-2 flex flex-wrap gap-2">
        <input
          required
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          required
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          placeholder="Department (optional)"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={addingTraveler}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          + Add traveler
        </button>
      </form>

      <p className="mt-5 text-sm font-semibold text-slate-700">New consolidated booking</p>
      {travelers && travelers.length > 0 ? (
        <form onSubmit={handleCreateBooking} className="mt-2 space-y-2">
          <input
            required
            placeholder="Trip description (e.g. Lagos–Abuja return flights, 12–15 Sept)"
            value={bookingDescription}
            onChange={(e) => setBookingDescription(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="space-y-1">
            {travelers.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <span className="w-40 shrink-0 text-slate-700">
                  {t.firstName} {t.lastName}
                </span>
                <input
                  type="number"
                  min={0}
                  placeholder="Amount (₦, leave blank to skip)"
                  value={selectedTravelers[t.id] ?? ''}
                  onChange={(e) => setTravelerAmount(t.id, e.target.value)}
                  className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
            ))}
          </div>
          <button
            type="submit"
            disabled={creatingBooking}
            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {creatingBooking ? 'Creating…' : 'Create booking & invoice'}
          </button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Add at least one traveler before creating a booking.</p>
      )}

      <p className="mt-5 text-sm font-semibold text-slate-700">Bookings</p>
      <div className="mt-2 space-y-2">
        {bookings?.map((b) => (
          <div key={b.id} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {b.description} <span className="ml-2 text-xs text-slate-500">{b.bookingReference}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {b.travelers.length} traveler{b.travelers.length === 1 ? '' : 's'} ·{' '}
                  {formatCurrency(b.totalAmount, b.currency)} · {formatDateTime(b.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    BOOKING_STATUS_STYLES[b.status] ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {b.status}
                </span>
                {b.status === 'CONFIRMED' && (
                  <button
                    onClick={() => handleCancelBooking(b.id)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {bookings?.length === 0 && <p className="text-xs text-slate-500">No bookings yet for this account.</p>}
      </div>
    </div>
  );
}

export default function AdminCorporateTravelPage() {
  const [accounts, setAccounts] = useState<CorporateAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function load() {
    apiRequest<CorporateAccount[]>('/corporate-travel/accounts')
      .then(setAccounts)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Corporate Travel" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Corporate Accounts</h2>
            <p className="mt-1 text-sm text-slate-500">
              Company-level booking on behalf of a client&apos;s traveling staff, with one
              consolidated invoice per booking.
            </p>
          </div>
          <button
            onClick={() => setShowNewAccount((v) => !v)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {showNewAccount ? 'Cancel' : '+ New Account'}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {showNewAccount && (
          <NewAccountForm
            onCreated={() => {
              setShowNewAccount(false);
              load();
            }}
          />
        )}

        <div className="mt-4 space-y-2">
          {accounts?.map((acct) => (
            <div key={acct.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setExpandedId(expandedId === acct.id ? null : acct.id)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-900">{acct.name}</p>
                  <p className="text-sm text-slate-500">
                    {acct.contactPersonName ?? 'No contact person on file'}
                    {acct.managedBranch ? ` · ${acct.managedBranch.name}` : ''}
                  </p>
                </div>
                <span className="text-sm text-slate-400">{expandedId === acct.id ? 'Hide' : 'Manage'}</span>
              </button>
              {expandedId === acct.id && <AccountDetail accountId={acct.id} />}
            </div>
          ))}
          {accounts?.length === 0 && (
            <p className="text-sm text-slate-500">No corporate accounts yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
