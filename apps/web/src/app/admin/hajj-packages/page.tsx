'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { HajjPackage, PackageStatus } from '@/lib/types';

const STATUSES: PackageStatus[] = ['DRAFT', 'PUBLISHED', 'FULLY_BOOKED', 'CLOSED', 'CANCELLED'];

interface FormState {
  name: string;
  description: string;
  price: string;
  internalCost: string;
  durationDays: string;
  departureDate: string;
  returnDate: string;
  airline: string;
  hotel: string;
  maxPilgrims: string;
  paymentPlan: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  price: '',
  internalCost: '',
  durationDays: '',
  departureDate: '',
  returnDate: '',
  airline: '',
  hotel: '',
  maxPilgrims: '',
  paymentPlan: '',
};

function toPayload(form: FormState) {
  return {
    name: form.name,
    description: form.description || undefined,
    price: Number(form.price),
    internalCost: form.internalCost ? Number(form.internalCost) : undefined,
    durationDays: form.durationDays ? Number(form.durationDays) : undefined,
    departureDate: form.departureDate || undefined,
    returnDate: form.returnDate || undefined,
    airline: form.airline || undefined,
    hotel: form.hotel || undefined,
    maxPilgrims: Number(form.maxPilgrims),
    paymentPlan: form.paymentPlan || undefined,
  };
}

export default function AdminHajjPackagesPage() {
  const [packages, setPackages] = useState<HajjPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  function load() {
    apiRequest<HajjPackage[]>('/hajj/packages/admin')
      .then(setPackages)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiRequest('/hajj/packages', { method: 'POST', body: toPayload(form) });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create package');
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(id: string, status: PackageStatus) {
    try {
      await apiRequest(`/hajj/packages/${id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this package? Only allowed if it has no registrations yet.')) return;
    try {
      await apiRequest(`/hajj/packages/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete package');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Hajj Packages" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Hajj Packages</h2>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {showCreate ? 'Cancel' : '+ New Package'}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
          >
            <input
              required
              placeholder="Package name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-3"
            />
            <textarea
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-3"
              rows={2}
            />
            <input
              required
              type="number"
              placeholder="Price per pilgrim (₦)"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Internal cost per pilgrim (₦)"
              value={form.internalCost}
              onChange={(e) => setForm({ ...form, internalCost: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              placeholder="Max pilgrims"
              value={form.maxPilgrims}
              onChange={(e) => setForm({ ...form, maxPilgrims: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Duration (days)"
              value={form.durationDays}
              onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <label className="text-xs text-slate-500">
              Departure date
              <input
                type="date"
                value={form.departureDate}
                onChange={(e) => setForm({ ...form, departureDate: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Return date
              <input
                type="date"
                value={form.returnDate}
                onChange={(e) => setForm({ ...form, returnDate: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <input
              placeholder="Airline"
              value={form.airline}
              onChange={(e) => setForm({ ...form, airline: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Hotel"
              value={form.hotel}
              onChange={(e) => setForm({ ...form, hotel: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Payment plan (free text)"
              value={form.paymentPlan}
              onChange={(e) => setForm({ ...form, paymentPlan: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-3"
            />
            <button
              type="submit"
              disabled={creating}
              className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-3"
            >
              {creating ? 'Creating…' : 'Create package (starts as Draft)'}
            </button>
          </form>
        )}

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Price</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Seats</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {packages?.map((pkg) => (
                <tr key={pkg.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{pkg.name}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(pkg.price, pkg.currency)}</td>
                  <td className="px-4 py-2 text-right text-slate-700">
                    {pkg.seatsAvailable} / {pkg.maxPilgrims}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={pkg.status}
                      onChange={(e) => handleStatusChange(pkg.id, e.target.value as PackageStatus)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(pkg.id)}
                      className="text-sm font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {packages?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    No Hajj packages yet.
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
