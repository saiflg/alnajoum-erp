'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';

interface PricingRule {
  id: string;
  name: string;
  type: 'FIXED' | 'PERCENTAGE';
  amount: number | null;
  percent: number | null;
  airlineCode: string | null;
  origin: string | null;
  destination: string | null;
  cabinClass: string | null;
  isPromotional: boolean;
  priority: number;
  isActive: boolean;
  staff: { firstName: string; lastName: string } | null;
  branch: { name: string } | null;
}

const EMPTY_FORM = {
  name: '',
  type: 'PERCENTAGE' as 'FIXED' | 'PERCENTAGE',
  amount: '',
  percent: '',
  airlineCode: '',
  origin: '',
  destination: '',
  priority: '0',
};

export default function AdminFlightPricingRulesPage() {
  const [rules, setRules] = useState<PricingRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<PricingRule[]>('/flights/pricing-rules')
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  async function handleCreate() {
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/flights/pricing-rules', {
        method: 'POST',
        body: {
          name: form.name,
          type: form.type,
          amount: form.type === 'FIXED' ? Number(form.amount) : undefined,
          percent: form.type === 'PERCENTAGE' ? Number(form.percent) : undefined,
          airlineCode: form.airlineCode || undefined,
          origin: form.origin || undefined,
          destination: form.destination || undefined,
          priority: Number(form.priority) || 0,
        },
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create rule');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule: PricingRule) {
    try {
      await apiRequest(`/flights/pricing-rules/${rule.id}`, {
        method: 'PATCH',
        body: { isActive: !rule.isActive },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update rule');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this pricing rule?')) return;
    try {
      await apiRequest(`/flights/pricing-rules/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete rule');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Flight Pricing Rules" navLinks={ADMIN_NAV}>
        <p className="text-sm text-slate-500">
          Configure the agency markup added on top of the provider&apos;s price. Never hard-coded — every booking
          resolves the most specific active rule that matches its airline/route/cabin/staff/branch, falling back to
          zero markup when nothing matches.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-w-3xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New rule</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-1"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'FIXED' | 'PERCENTAGE' })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED">Fixed amount</option>
            </select>
            {form.type === 'FIXED' ? (
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
            <input
              placeholder="Priority"
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Airline code (optional)"
              value={form.airlineCode}
              onChange={(e) => setForm({ ...form, airlineCode: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Origin (optional)"
              value={form.origin}
              onChange={(e) => setForm({ ...form, origin: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Destination (optional)"
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add rule'}
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Markup</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Scope</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Priority</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules?.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.type === 'FIXED' ? formatCurrency(r.amount ?? 0, 'NGN') : `${r.percent ?? 0}%`}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {[r.airlineCode, r.origin && r.destination ? `${r.origin}→${r.destination}` : null, r.cabinClass]
                      .filter(Boolean)
                      .join(' · ') || 'Global'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.priority}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleActive(r)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {r.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(r.id)} className="text-xs font-medium text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {rules?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                    No pricing rules configured yet — every booking will have zero markup until one exists.
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
