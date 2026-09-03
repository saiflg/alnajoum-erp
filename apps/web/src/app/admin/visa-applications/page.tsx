'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { VisaApplication, VisaApplicationStatus } from '@/lib/types';

const STATUSES: Array<VisaApplicationStatus | ''> = [
  '',
  'SUBMITTED',
  'IN_REVIEW',
  'ADDITIONAL_DOCUMENTS_REQUIRED',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'CANCELLED',
];

const NEXT_STATUSES: VisaApplicationStatus[] = [
  'IN_REVIEW',
  'ADDITIONAL_DOCUMENTS_REQUIRED',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'CANCELLED',
];

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-700',
  IN_REVIEW: 'bg-amber-100 text-amber-700',
  ADDITIONAL_DOCUMENTS_REQUIRED: 'bg-orange-100 text-orange-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  ISSUED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const TERMINAL: VisaApplicationStatus[] = ['ISSUED', 'REJECTED', 'CANCELLED'];

export default function AdminVisaApplicationsPage() {
  const [applications, setApplications] = useState<VisaApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VisaApplicationStatus | ''>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<VisaApplication[]>(`/visa/applications?${params.toString()}`)
      .then(setApplications)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [statusFilter]);

  async function handleStatusChange(id: string, status: VisaApplicationStatus) {
    if (!status) return;
    const staffNote =
      prompt(
        status === 'REJECTED'
          ? 'Reason for rejecting this application:'
          : 'Optional note for the applicant:',
      ) ?? undefined;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/visa/applications/${id}/status`, {
        method: 'POST',
        body: { status, staffNote: staffNote || undefined },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Visa Applications" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Visa Applications</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as VisaApplicationStatus | '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          {applications?.map((app) => (
            <div key={app.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {app.customer ? `${app.customer.firstName} ${app.customer.lastName}` : '—'} —{' '}
                    {app.destinationCountry} ({app.visaType.replace(/_/g, ' ')})
                    <span className="ml-2 text-xs text-slate-500">{app.applicationReference}</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    {app.applicantFirstName} {app.applicantLastName} ·{' '}
                    {formatCurrency(app.totalAmount, app.currency)} · {formatDateTime(app.createdAt)}
                  </p>
                  {app.staffNote && (
                    <p className="mt-1 text-xs text-slate-500">Note: {app.staffNote}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[app.status] ?? 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {app.status.replace(/_/g, ' ')}
                  </span>
                  {!TERMINAL.includes(app.status) && (
                    <select
                      value=""
                      disabled={busyId === app.id}
                      onChange={(e) =>
                        handleStatusChange(app.id, e.target.value as VisaApplicationStatus)
                      }
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="">Change status…</option>
                      {NEXT_STATUSES.filter((s) => s !== app.status).map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}
          {applications?.length === 0 && (
            <p className="text-sm text-slate-500">No visa applications found.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
