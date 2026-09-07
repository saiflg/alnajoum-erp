'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { FlightServiceFee, FlightServiceFeeType } from '@/lib/types';

const FEE_TYPES: FlightServiceFeeType[] = [
  'BOOKING',
  'TICKETING',
  'CANCELLATION',
  'REFUND_PROCESSING',
  'REISSUE',
  'CHANGE',
  'ANCILLARY',
];

const EMPTY_FORM = {
  type: 'TICKETING' as FlightServiceFeeType,
  mode: 'FLAT' as 'FLAT' | 'PERCENT',
  amount: '',
  percent: '',
};

export default function AdminFlightServiceFeesPage() {
  const [fees, setFees] = useState<FlightServiceFee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<FlightServiceFee[]>('/flights/service-fees')
      .then(setFees)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  async function handleCreate() {
    setError(null);
    if (form.mode === 'FLAT' && !form.amount) {
      setError('Enter a flat amount.');
      return;
    }
    if (form.mode === 'PERCENT' && !form.percent) {
      setError('Enter a percentage.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/flights/service-fees', {
        method: 'POST',
        body: {
          type: form.type,
          amount: form.mode === 'FLAT' ? Number(form.amount) : undefined,
          percent: form.mode === 'PERCENT' ? Number(form.percent) : undefined,
        },
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create service fee');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(fee: FlightServiceFee) {
    try {
      await apiRequest(`/flights/service-fees/${fee.id}`, {
        method: 'PATCH',
        body: { isActive: !fee.isActive },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update service fee');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this service fee?')) return;
    try {
      await apiRequest(`/flights/service-fees/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete service fee');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Flight Service Fees" navLinks={ADMIN_NAV}>
        <p className="text-sm text-slate-500">
          Flat or percentage agency charges layered on top of the fare markup (e.g. a fixed
          ticketing fee, or a percentage cancellation fee). The single active fee for each type
          is applied — never invented when none is configured.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New service fee</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as FlightServiceFeeType })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {FEE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as 'FLAT' | 'PERCENT' })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="FLAT">Flat amount</option>
              <option value="PERCENT">Percentage</option>
            </select>
            {form.mode === 'FLAT' ? (
              <input
                placeholder="Amount (₦)"
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            ) : (
              <input
                placeholder="Percent (%)"
                type="number"
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            )}
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add fee'}
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Fee</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fees?.map((fee) => (
                <tr key={fee.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {fee.type.replace('_', ' ')}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {fee.amount != null ? formatCurrency(fee.amount, 'NGN') : `${fee.percent}%`}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleActive(fee)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${fee.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {fee.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => remove(fee.id)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {fees?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                    No service fees configured yet.
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
