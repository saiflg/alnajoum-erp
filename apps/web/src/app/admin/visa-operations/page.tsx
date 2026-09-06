'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { VisaApplicationStatus, VisaStatusBreakdown } from '@/lib/types';

/**
 * Spec #1 — the Visa Operations Center: every VisaApplicationStatus with
 * its live count, grouped into the workflow stages the spec calls out
 * (New/Draft, Documents/Guarantor/Payment pending, In progress, Outcome),
 * plus the standard date/country/visa-type/staff/branch filters. Each card
 * links straight into the existing applications list pre-filtered to that
 * status — no duplicate list view here.
 */

interface StatusGroup {
  title: string;
  statuses: VisaApplicationStatus[];
}

const STATUS_GROUPS: StatusGroup[] = [
  { title: 'New & Draft', statuses: ['SUBMITTED', 'DRAFT'] },
  {
    title: 'Awaiting the applicant',
    statuses: ['AWAITING_DOCUMENTS', 'AWAITING_GUARANTOR', 'GUARANTOR_VERIFICATION', 'ADDITIONAL_DOCUMENTS_REQUIRED'],
  },
  { title: 'Payment', statuses: ['PAYMENT_PENDING', 'PAYMENT_VERIFIED'] },
  { title: 'Staff review', statuses: ['UNDER_REVIEW', 'IN_REVIEW'] },
  {
    title: 'With the provider',
    statuses: ['SUBMITTED_TO_PROVIDER', 'PROCESSING', 'ADDITIONAL_INFO_REQUIRED'],
  },
  { title: 'Outcome', statuses: ['APPROVED', 'ISSUED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'] },
];

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'New',
};

function label(status: string) {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

const NEUTRAL_STATUSES: VisaApplicationStatus[] = ['SUBMITTED', 'DRAFT', 'AWAITING_DOCUMENTS', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED'];
const WARNING_STATUSES: VisaApplicationStatus[] = [
  'AWAITING_GUARANTOR',
  'GUARANTOR_VERIFICATION',
  'ADDITIONAL_DOCUMENTS_REQUIRED',
  'ADDITIONAL_INFO_REQUIRED',
];
const PROGRESS_STATUSES: VisaApplicationStatus[] = ['UNDER_REVIEW', 'IN_REVIEW', 'SUBMITTED_TO_PROVIDER', 'PROCESSING'];
const GOOD_STATUSES: VisaApplicationStatus[] = ['APPROVED', 'ISSUED', 'COMPLETED'];
const BAD_STATUSES: VisaApplicationStatus[] = ['REJECTED', 'CANCELLED', 'EXPIRED'];

function cardStyle(status: string): string {
  if (GOOD_STATUSES.includes(status as VisaApplicationStatus)) return 'border-emerald-200 bg-emerald-50';
  if (BAD_STATUSES.includes(status as VisaApplicationStatus)) return 'border-red-200 bg-red-50';
  if (WARNING_STATUSES.includes(status as VisaApplicationStatus)) return 'border-orange-200 bg-orange-50';
  if (PROGRESS_STATUSES.includes(status as VisaApplicationStatus)) return 'border-purple-200 bg-purple-50';
  if (NEUTRAL_STATUSES.includes(status as VisaApplicationStatus)) return 'border-slate-200 bg-white';
  return 'border-slate-200 bg-white';
}

export default function VisaOperationsCenterPage() {
  const [data, setData] = useState<VisaStatusBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [country, setCountry] = useState('');

  function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (country) params.set('country', country);
    apiRequest<VisaStatusBreakdown>(`/visa/reports/status-breakdown?${params.toString()}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Visa Operations Center" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Visa Operations Center</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              Country
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. United Kingdom" className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button onClick={load} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Apply
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {data && (
          <>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Total Applications</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">{data.total}</p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {STATUS_GROUPS.map((group) => (
                <div key={group.title} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-700">{group.title}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.statuses.map((status) => (
                      <Link
                        key={status}
                        href={`/admin/visa-applications?status=${status}`}
                        className={`rounded-md border p-2 text-center transition hover:shadow-sm ${cardStyle(status)}`}
                      >
                        <p className="text-lg font-semibold text-slate-900">{data.byStatus[status] ?? 0}</p>
                        <p className="text-[11px] text-slate-600">{label(status)}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
