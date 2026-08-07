'use client';

import { Fragment, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { Notification, NotificationStatus, NotificationType } from '@/lib/types';

const TYPES: Array<NotificationType | ''> = [
  '',
  'STAFF_TEMP_PASSWORD',
  'BOOKING_CONFIRMATION',
  'PAYMENT_RECEIPT',
];
const STATUSES: Array<NotificationStatus | ''> = ['', 'SENT', 'FAILED'];

const STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

export default function AdminNotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<NotificationType | ''>('');
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | ''>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<Notification[]>(`/notifications?${params.toString()}`)
      .then(setNotifications)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [typeFilter, statusFilter]);

  const navLinks =
    user?.roles.includes('FINANCE_OFFICER') && user.roles.length === 1
      ? FINANCE_NAV
      : ADMIN_NAV;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Notifications" navLinks={navLinks}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as NotificationType | '')}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t ? t.replace('_', ' ') : 'All types'}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as NotificationStatus | '')}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s || 'All statuses'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Recipient</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Subject</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Date</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {notifications?.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === n.id ? null : n.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-2 text-slate-700">{n.type.replace('_', ' ')}</td>
                    <td className="px-4 py-2 text-slate-600">{n.recipient}</td>
                    <td className="px-4 py-2 text-slate-600">{n.subject}</td>
                    <td className="px-4 py-2 text-slate-600">{formatDateTime(n.createdAt)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[n.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {n.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === n.id && (
                    <tr key={`${n.id}-detail`}>
                      <td colSpan={5} className="bg-slate-50 px-4 py-3">
                        <pre className="whitespace-pre-wrap text-xs text-slate-600">{n.body}</pre>
                        {n.errorMessage && (
                          <p className="mt-2 text-xs text-red-600">Error: {n.errorMessage}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {notifications?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    No notifications found.
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
