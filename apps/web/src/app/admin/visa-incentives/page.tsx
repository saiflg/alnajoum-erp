'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { IncentiveStatus, StaffIncentive } from '@/lib/types';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  PAID: 'bg-emerald-100 text-emerald-700',
};

const PAYOUT_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SUCCESSFUL: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
};

function BankDetailsForm() {
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/visa/payouts/me/bank-details', {
        method: 'PATCH',
        body: { bankName, bankAccountNumber, bankAccountName },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save bank details');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h2 className="text-sm font-semibold text-slate-900">My Payout Bank Details</h2>
      <p className="mt-1 text-xs text-slate-500">
        Required before any incentive earned by you can be paid out.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input required placeholder="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input required placeholder="Account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input required placeholder="Account name" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </form>
      {saved && <p className="mt-2 text-xs text-emerald-600">Bank details saved.</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function AdminVisaIncentivesPage() {
  const [incentives, setIncentives] = useState<StaffIncentive[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<IncentiveStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<StaffIncentive[]>(`/visa/incentives?${params.toString()}`)
      .then(setIncentives)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [statusFilter]);

  async function handleApprove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/visa/incentives/${id}/approve`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Reason for rejecting this incentive:');
    if (!reason) return;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/visa/incentives/${id}/reject`, { method: 'POST', body: { reason } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePayout(id: string, retry: boolean) {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/visa/payouts/${id}/${retry ? 'retry' : 'pay'}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to trigger payout');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Visa Incentives & Payouts" navLinks={ADMIN_NAV}>
        <BankDetailsForm />

        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Staff Incentives</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as IncentiveStatus | '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            {(['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as IncentiveStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          {incentives?.map((inc) => (
            <div key={inc.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {inc.staff ? `${inc.staff.firstName} ${inc.staff.lastName}` : inc.staffId}
                    <span className="ml-2 text-xs text-slate-500">{inc.referenceNumber}</span>
                  </p>
                  <p className="text-sm text-slate-500">{inc.description}</p>
                  {inc.companyCost != null && (
                    <p className="mt-1 text-xs text-slate-500">
                      Company cost {formatCurrency(inc.companyCost, inc.currency)} · Selling price{' '}
                      {formatCurrency(inc.sellingPrice ?? 0, inc.currency)} · Margin{' '}
                      {formatCurrency(inc.margin ?? 0, inc.currency)}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    Incentive: {formatCurrency(inc.amount, inc.currency)}
                  </p>
                  <p className="text-xs text-slate-400">{formatDateTime(inc.createdAt)}</p>
                  {inc.payout && (
                    <p className="mt-1 text-xs">
                      Payout:{' '}
                      <span className={`rounded-full px-2 py-0.5 font-medium ${PAYOUT_STYLES[inc.payout.status]}`}>
                        {inc.payout.status}
                      </span>
                      {inc.payout.providerError && <span className="ml-2 text-red-600">{inc.payout.providerError}</span>}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[inc.status]}`}>
                    {inc.status}
                  </span>
                  {inc.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(inc.id)} disabled={busyId === inc.id} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                        Approve
                      </button>
                      <button onClick={() => handleReject(inc.id)} disabled={busyId === inc.id} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  )}
                  {inc.status === 'APPROVED' && (!inc.payout || inc.payout.status === 'FAILED') && (
                    <button
                      onClick={() => handlePayout(inc.id, inc.payout?.status === 'FAILED')}
                      disabled={busyId === inc.id}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {inc.payout?.status === 'FAILED' ? 'Retry payout' : 'Pay out'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {incentives?.length === 0 && <p className="text-sm text-slate-500">No incentives found.</p>}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
