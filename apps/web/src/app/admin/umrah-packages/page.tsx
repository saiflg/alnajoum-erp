'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { PackageStatus, UmrahPackage, UmrahPackageType } from '@/lib/types';

const STATUSES: PackageStatus[] = ['DRAFT', 'PUBLISHED', 'FULLY_BOOKED', 'CLOSED', 'CANCELLED'];
const PACKAGE_TYPES: UmrahPackageType[] = ['GROUP', 'FAMILY', 'VIP', 'ECONOMY', 'CUSTOM'];

interface FormState {
  name: string;
  description: string;
  packageType: UmrahPackageType;
  costPrice: string;
  sellingPrice: string;
  incentivePercent: string;
  durationDays: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  flight: string;
  maxPilgrims: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  packageType: 'GROUP',
  costPrice: '',
  sellingPrice: '',
  incentivePercent: '',
  durationDays: '',
  departureDate: '',
  returnDate: '',
  hotel: '',
  flight: '',
  maxPilgrims: '',
};

function toPayload(form: FormState) {
  return {
    name: form.name,
    description: form.description || undefined,
    packageType: form.packageType,
    costPrice: Number(form.costPrice),
    sellingPrice: Number(form.sellingPrice),
    incentiveRule: form.incentivePercent ? { percent: Number(form.incentivePercent) } : undefined,
    durationDays: form.durationDays ? Number(form.durationDays) : undefined,
    departureDate: form.departureDate || undefined,
    returnDate: form.returnDate || undefined,
    hotel: form.hotel || undefined,
    flight: form.flight || undefined,
    maxPilgrims: Number(form.maxPilgrims),
  };
}

export default function AdminUmrahPackagesPage() {
  const [packages, setPackages] = useState<UmrahPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  function load() {
    apiRequest<UmrahPackage[]>('/umrah/packages/admin')
      .then(setPackages)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiRequest('/umrah/packages', { method: 'POST', body: toPayload(form) });
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
      await apiRequest(`/umrah/packages/${id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this package? Only allowed if it has no registrations yet.')) return;
    try {
      await apiRequest(`/umrah/packages/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete package');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Umrah Packages" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Umrah Packages</h2>
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
            <select
              value={form.packageType}
              onChange={(e) => setForm({ ...form, packageType: e.target.value as UmrahPackageType })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {PACKAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              required
              type="number"
              placeholder="Cost price (₦)"
              value={form.costPrice}
              onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              placeholder="Selling price (₦)"
              value={form.sellingPrice}
              onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              step="0.1"
              placeholder="Staff incentive % (optional)"
              value={form.incentivePercent}
              onChange={(e) => setForm({ ...form, incentivePercent: e.target.value })}
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
              placeholder="Hotel"
              value={form.hotel}
              onChange={(e) => setForm({ ...form, hotel: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Flight / Airline"
              value={form.flight}
              onChange={(e) => setForm({ ...form, flight: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
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
                  <td className="px-4 py-2 text-slate-600">{pkg.packageType}</td>
                  <td className="px-4 py-2 text-right text-slate-700">
                    {formatCurrency(pkg.sellingPrice, pkg.currency)}
                  </td>
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
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No Umrah packages yet.
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
