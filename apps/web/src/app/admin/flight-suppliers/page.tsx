'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { FlightSupplier, FlightSupplierContract, FlightSupplierType } from '@/lib/types';

const SUPPLIER_TYPES: FlightSupplierType[] = ['GDS', 'NDC', 'LCC', 'CONSOLIDATOR', 'AIRLINE', 'MANUAL'];

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  SUSPENDED: 'bg-amber-100 text-amber-700',
  CLOSED: 'bg-slate-100 text-slate-500',
};

const EMPTY_FORM = {
  name: '',
  type: 'AIRLINE' as FlightSupplierType,
  currency: 'NGN',
  creditLimit: '',
  paymentTerms: '',
  settlementCycle: '',
};

export default function AdminFlightSuppliersPage() {
  const [suppliers, setSuppliers] = useState<FlightSupplier[] | null>(null);
  const [expiringContracts, setExpiringContracts] = useState<FlightSupplierContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<FlightSupplier[]>('/flight-suppliers')
      .then(setSuppliers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    apiRequest<FlightSupplierContract[]>('/flight-supplier-contracts/expiring-soon')
      .then(setExpiringContracts)
      .catch(() => setExpiringContracts(null));
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
      await apiRequest('/flight-suppliers', {
        method: 'POST',
        body: {
          name: form.name,
          type: form.type,
          currency: form.currency || undefined,
          creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
          paymentTerms: form.paymentTerms || undefined,
          settlementCycle: form.settlementCycle || undefined,
        },
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create supplier');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Flight Suppliers" navLinks={ADMIN_NAV}>
        <p className="text-sm text-slate-500">
          Master records for the airlines/GDS/consolidators the agency settles with — separate
          from (and linked to) the general supplier-payable ledger used across every module.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {expiringContracts && expiringContracts.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Contracts expiring soon</p>
            <ul className="mt-2 space-y-1">
              {expiringContracts.map((c) => (
                <li key={c.id} className="text-sm text-amber-800">
                  {c.supplier?.name ?? 'Unknown supplier'} — {c.name} expires{' '}
                  {c.endDate ? new Date(c.endDate).toLocaleDateString() : '—'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New supplier</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-1"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as FlightSupplierType })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {SUPPLIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              placeholder="Currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Credit limit (optional)"
              type="number"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Payment terms (e.g. Net 30)"
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Settlement cycle (e.g. Weekly)"
              value={form.settlementCycle}
              onChange={(e) => setForm({ ...form, settlementCycle: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add supplier'}
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Terms</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers?.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="px-3 py-2 text-slate-600">{s.type}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {[s.paymentTerms, s.settlementCycle].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/flight-suppliers/${s.id}`}
                      className="text-xs font-medium text-slate-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {suppliers?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                    No suppliers configured yet.
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
