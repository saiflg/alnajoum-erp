'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { FlightSupplier, FlightSupplierBalance, FlightSupplierContract } from '@/lib/types';

const CONTRACT_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  EXPIRED: 'bg-red-100 text-red-700',
  TERMINATED: 'bg-slate-100 text-slate-500',
};

const EMPTY_CONTRACT_FORM = {
  name: '',
  startDate: '',
  endDate: '',
  commissionPercent: '',
  markupPercent: '',
  settlementTerms: '',
};

export default function AdminFlightSupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<FlightSupplier | null>(null);
  const [balance, setBalance] = useState<FlightSupplierBalance | null>(null);
  const [contracts, setContracts] = useState<FlightSupplierContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_CONTRACT_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<FlightSupplier>(`/flight-suppliers/${params.id}`)
      .then(setSupplier)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load supplier'));
    apiRequest<FlightSupplierBalance>(`/flight-suppliers/${params.id}/balance`)
      .then(setBalance)
      .catch(() => setBalance(null));
    apiRequest<FlightSupplierContract[]>(`/flight-suppliers/${params.id}/contracts`)
      .then(setContracts)
      .catch(() => setContracts(null));
  }

  useEffect(load, [params.id]);

  async function handleCreateContract() {
    setError(null);
    if (!form.name.trim() || !form.startDate) {
      setError('Contract name and start date are required.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/flight-suppliers/${params.id}/contracts`, {
        method: 'POST',
        body: {
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate || undefined,
          commissionPercent: form.commissionPercent ? Number(form.commissionPercent) : undefined,
          markupPercent: form.markupPercent ? Number(form.markupPercent) : undefined,
          settlementTerms: form.settlementTerms || undefined,
        },
      });
      setForm(EMPTY_CONTRACT_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create contract');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Supplier Detail" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {supplier && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">{supplier.name}</h2>
            <p className="text-sm text-slate-500">
              {supplier.type} · {supplier.currency}
              {supplier.apiStatus ? ` · ${supplier.apiStatus}` : ''}
            </p>

            {balance && (
              <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Credit &amp; balance</h3>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500">Outstanding</p>
                    <p className="font-medium text-slate-800">
                      {formatCurrency(balance.currentBalance, supplier.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total paid</p>
                    <p className="font-medium text-slate-800">
                      {formatCurrency(balance.totalPaid, supplier.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Credit limit</p>
                    <p className="font-medium text-slate-800">
                      {balance.creditLimit != null
                        ? formatCurrency(balance.creditLimit, supplier.currency)
                        : 'No limit set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Utilization</p>
                    <p className="font-medium text-slate-800">
                      {balance.utilization != null
                        ? `${Math.round(balance.utilization * 100)}%`
                        : '—'}
                    </p>
                  </div>
                </div>
                {balance.alert && (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                    ⚠ {balance.alert}
                  </p>
                )}
              </div>
            )}

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Contracts</h3>
            <div className="mt-2 max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Start</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">End</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Terms</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contracts?.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {formatDateTime(c.startDate)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.endDate ? formatDateTime(c.endDate) : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{c.settlementTerms ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONTRACT_STATUS_STYLES[c.status] ?? 'bg-slate-100 text-slate-600'}`}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {contracts?.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-center text-slate-500" colSpan={5}>
                        No contracts on file for this supplier.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="border-t border-slate-100 p-4">
                <h4 className="text-sm font-semibold text-slate-900">New contract</h4>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <input
                    placeholder="Contract name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-1"
                  />
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="End date (optional)"
                  />
                  <input
                    placeholder="Commission %"
                    type="number"
                    value={form.commissionPercent}
                    onChange={(e) => setForm({ ...form, commissionPercent: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Markup %"
                    type="number"
                    value={form.markupPercent}
                    onChange={(e) => setForm({ ...form, markupPercent: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Settlement terms"
                    value={form.settlementTerms}
                    onChange={(e) => setForm({ ...form, settlementTerms: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  onClick={handleCreateContract}
                  disabled={saving}
                  className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Add contract'}
                </button>
              </div>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
