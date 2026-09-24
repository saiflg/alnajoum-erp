'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { Supplier, SupplierType } from '@/lib/types';

const SUPPLIER_TYPES: SupplierType[] = [
  'AIRLINE',
  'GDS',
  'FLIGHT_CONSOLIDATOR',
  'HOTEL',
  'HOTEL_WHOLESALER',
  'VISA_PROVIDER',
  'HAJJ_SUPPLIER',
  'UMRAH_SUPPLIER',
  'TRANSPORT_COMPANY',
  'BUS_OPERATOR',
  'CAR_RENTAL',
  'ACTIVITY_PROVIDER',
  'TOUR_OPERATOR',
  'INSURANCE_PROVIDER',
  'TICKET_CONSOLIDATOR',
  'GROUND_HANDLER',
  'LOCAL_PARTNER',
  'OTHER',
];

const ONBOARDING_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  INVITED: 'bg-slate-100 text-slate-600',
  INFORMATION_SUBMITTED: 'bg-blue-100 text-blue-700',
  KYC_REVIEW: 'bg-blue-100 text-blue-700',
  DOCUMENT_REVIEW: 'bg-blue-100 text-blue-700',
  COMMERCIAL_REVIEW: 'bg-blue-100 text-blue-700',
  FINANCE_REVIEW: 'bg-blue-100 text-blue-700',
  ADMIN_APPROVAL: 'bg-amber-100 text-amber-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  SUSPENDED: 'bg-amber-100 text-amber-700',
  TERMINATED: 'bg-red-100 text-red-700',
};

const EMPTY_FORM = {
  legalName: '',
  type: 'HOTEL_WHOLESALER' as SupplierType,
  country: '',
  currency: 'NGN',
  paymentTerms: '',
};

/**
 * Phase 16 — the domain-agnostic supplier list. Deliberately a basic list/
 * create screen, not the full "admin supplier control center" dashboard
 * spec #46 sketches (KPIs, alerts, pending-approval queue) — see
 * SuppliersModule's own doc comment for what this increment builds vs.
 * defers.
 */
export default function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    const query = typeFilter ? `?type=${typeFilter}` : '';
    apiRequest<Supplier[]>(`/suppliers${query}`)
      .then(setSuppliers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [typeFilter]);

  async function handleCreate() {
    setError(null);
    if (!form.legalName.trim()) {
      setError('Legal name is required.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/suppliers', {
        method: 'POST',
        body: {
          legalName: form.legalName,
          type: form.type,
          country: form.country || undefined,
          currency: form.currency || undefined,
          paymentTerms: form.paymentTerms || undefined,
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
      <AppShell title="Suppliers" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Suppliers</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Master records for hotel/visa/Hajj/Umrah/transport suppliers — flight suppliers have
              their own dedicated page since Phase 10&apos;s FlightSupplier system already covers
              them.
            </p>
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">All types</option>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-w-3xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New supplier</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              placeholder="Legal name"
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as SupplierType })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {SUPPLIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            <input
              placeholder="Country"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Payment terms (e.g. Net 30)"
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
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
                <th className="px-3 py-2 text-left font-medium text-slate-600">Legal name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Country</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Onboarding</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">KYC</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers?.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {s.legalName}
                    {s.tradingName && (
                      <span className="ml-1 text-xs text-slate-400">({s.tradingName})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{s.type.replaceAll('_', ' ')}</td>
                  <td className="px-3 py-2 text-slate-600">{s.country ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ONBOARDING_STYLES[s.onboardingStatus] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {s.onboardingStatus.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{s.kycStatus.replaceAll('_', ' ')}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/suppliers/${s.id}`}
                      className="text-xs font-medium text-slate-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {suppliers?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
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
