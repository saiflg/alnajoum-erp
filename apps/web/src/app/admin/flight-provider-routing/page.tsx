'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { FlightProviderName, FlightProviderRoutingRule } from '@/lib/types';

const PROVIDERS: FlightProviderName[] = ['MOCK', 'DUFFEL', 'SABRE', 'AMADEUS', 'TRAVELPORT', 'TBO'];

const EMPTY_FORM = {
  origin: '',
  destination: '',
  providerPriority: [] as FlightProviderName[],
  priority: '0',
};

export default function AdminFlightProviderRoutingPage() {
  const [rules, setRules] = useState<FlightProviderRoutingRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<FlightProviderRoutingRule[]>('/flights/provider-routing-rules')
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  function toggleProvider(p: FlightProviderName) {
    setForm((f) => ({
      ...f,
      providerPriority: f.providerPriority.includes(p)
        ? f.providerPriority.filter((x) => x !== p)
        : [...f.providerPriority, p],
    }));
  }

  async function handleCreate() {
    setError(null);
    if (form.providerPriority.length === 0) {
      setError('Select at least one provider, in the order they should be tried.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/flights/provider-routing-rules', {
        method: 'POST',
        body: {
          origin: form.origin || undefined,
          destination: form.destination || undefined,
          providerPriority: form.providerPriority,
          priority: Number(form.priority) || 0,
        },
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create routing rule');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule: FlightProviderRoutingRule) {
    try {
      await apiRequest(`/flights/provider-routing-rules/${rule.id}`, {
        method: 'PATCH',
        body: { isActive: !rule.isActive },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update routing rule');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this routing rule?')) return;
    try {
      await apiRequest(`/flights/provider-routing-rules/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete routing rule');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Flight Provider Routing" navLinks={ADMIN_NAV}>
        <p className="text-sm text-slate-500">
          Controls which providers <strong>search</strong> tries, and in what order, for a given
          route. A route-scoped rule (e.g. LOS → DXB) beats the global default when both exist.
          This never affects booking, ticketing, refund or void — those always stay on whichever
          provider actually holds the order, so a routing change can never create a duplicate
          booking.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New routing rule</h3>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <input
              placeholder="Origin (optional, e.g. LOS)"
              value={form.origin}
              onChange={(e) => setForm({ ...form, origin: e.target.value.toUpperCase() })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Destination (optional, e.g. DXB)"
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value.toUpperCase() })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Priority (higher wins)"
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <p className="mt-3 text-xs font-medium text-slate-600">
            Provider try-order — click in the order they should be attempted:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROVIDERS.map((p) => {
              const idx = form.providerPriority.indexOf(p);
              return (
                <button
                  key={p}
                  onClick={() => toggleProvider(p)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                    idx >= 0
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {idx >= 0 ? `${idx + 1}. ` : ''}
                  {p}
                </button>
              );
            })}
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add rule'}
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Route</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Provider order</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Priority</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules?.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {rule.origin && rule.destination
                      ? `${rule.origin} → ${rule.destination}`
                      : 'Global default'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {rule.providerPriority.join(' → ')}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{rule.priority}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleActive(rule)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${rule.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => remove(rule.id)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {rules?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                    No routing rules configured — search always uses the currently active
                    provider.
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
