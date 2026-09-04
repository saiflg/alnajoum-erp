'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

const COMPONENT_TYPES = ['FLIGHT', 'HOTEL', 'VISA', 'TRANSPORT', 'MEALS', 'INSURANCE', 'TOUR', 'OTHER'];

interface ComponentForm {
  type: string;
  description: string;
  cost: string;
  price: string;
}

interface PackageComponent {
  id: string;
  type: string;
  description: string;
  cost: number;
  price: number;
}

interface TravelPackage {
  id: string;
  packageReference: string;
  name: string;
  category: string;
  totalCost: number;
  totalPrice: number;
  currency: string;
  customer: { firstName: string; lastName: string } | null;
  components: PackageComponent[];
  invoice: { status: string } | null;
  createdAt: string;
}

const EMPTY_COMPONENT: ComponentForm = { type: 'FLIGHT', description: '', cost: '', price: '' };

export default function AdminTravelPackagesPage() {
  const [packages, setPackages] = useState<TravelPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [components, setComponents] = useState<ComponentForm[]>([{ ...EMPTY_COMPONENT }]);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<TravelPackage[]>('/travel-packages')
      .then(setPackages)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  function updateComponent(index: number, patch: Partial<ComponentForm>) {
    setComponents((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addComponentRow() {
    setComponents((prev) => [...prev, { ...EMPTY_COMPONENT }]);
  }

  function removeComponentRow(index: number) {
    setComponents((prev) => prev.filter((_, i) => i !== index));
  }

  const totalCost = components.reduce((s, c) => s + (Number(c.cost) || 0), 0);
  const totalPrice = components.reduce((s, c) => s + (Number(c.price) || 0), 0);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !customerId.trim()) {
      setError('Package name and customer ID are required.');
      return;
    }
    const validComponents = components.filter((c) => c.description.trim() && c.cost && c.price);
    if (validComponents.length === 0) {
      setError('At least one complete component (description, cost, price) is required.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/travel-packages', {
        method: 'POST',
        body: {
          name,
          customerId,
          components: validComponents.map((c) => ({
            type: c.type,
            description: c.description,
            cost: Number(c.cost),
            price: Number(c.price),
          })),
        },
      });
      setName('');
      setCustomerId('');
      setComponents([{ ...EMPTY_COMPONENT }]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create package');
    } finally {
      setSaving(false);
    }
  }

  async function confirmIncentive(id: string) {
    try {
      await apiRequest(`/travel-packages/${id}/confirm-incentive`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to confirm incentive');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Travel Packages" navLinks={ADMIN_NAV}>
        <p className="text-sm text-slate-500">
          Build a custom multi-component itinerary (flight + hotel + visa + transport + ...) for a customer. Total
          cost, price, and margin are simple sums of each component&apos;s own numbers — never a second, independent
          calculation.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-w-3xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New package</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <input
              placeholder="Package name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Customer ID"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>

          <h4 className="mt-4 text-xs font-semibold text-slate-700">Components</h4>
          <div className="mt-2 space-y-2">
            {components.map((c, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <select
                  value={c.type}
                  onChange={(e) => updateComponent(i, { type: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  {COMPONENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  placeholder="Description"
                  value={c.description}
                  onChange={(e) => updateComponent(i, { description: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs sm:col-span-2"
                />
                <input
                  placeholder="Cost"
                  type="number"
                  value={c.cost}
                  onChange={(e) => updateComponent(i, { cost: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <div className="flex gap-1">
                  <input
                    placeholder="Price"
                    type="number"
                    value={c.price}
                    onChange={(e) => updateComponent(i, { price: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  {components.length > 1 && (
                    <button onClick={() => removeComponentRow(i)} className="text-xs text-red-600">✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button onClick={addComponentRow} className="mt-2 text-xs font-medium text-slate-700 hover:underline">
            + Add component
          </button>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
            <span className="text-slate-600">
              Total cost {formatCurrency(totalCost, 'NGN')} · Total price {formatCurrency(totalPrice, 'NGN')} ·{' '}
              <span className="font-medium text-emerald-700">Margin {formatCurrency(totalPrice - totalCost, 'NGN')}</span>
            </span>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Create package'}
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {packages?.map((pkg) => (
            <div key={pkg.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {pkg.name} <span className="font-normal text-slate-500">— {pkg.packageReference}</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    {pkg.customer ? `${pkg.customer.firstName} ${pkg.customer.lastName}` : '—'} · {pkg.components.length} component(s) ·{' '}
                    {formatDateTime(pkg.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(pkg.totalPrice, pkg.currency)}</p>
                  <p className="text-xs text-emerald-700">Margin {formatCurrency(pkg.totalPrice - pkg.totalCost, pkg.currency)}</p>
                  {pkg.invoice?.status === 'PAID' && (
                    <button onClick={() => confirmIncentive(pkg.id)} className="mt-1 text-xs font-medium text-blue-700 hover:underline">
                      Confirm incentive
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {pkg.components.map((c) => (
                  <span key={c.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {c.type}: {c.description}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {packages?.length === 0 && <p className="text-sm text-slate-500">No travel packages yet.</p>}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
