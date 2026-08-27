'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { Notification } from '@/lib/types';

export default function PortalNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiRequest<Notification[]>('/notifications/me')
      .then(setNotifications)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function markRead(id: string) {
    try {
      await apiRequest(`/notifications/me/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) => prev?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark as read');
    }
  }

  async function markAllRead() {
    try {
      await apiRequest('/notifications/me/read-all', { method: 'PATCH' });
      setNotifications((prev) => prev?.map((n) => ({ ...n, isRead: true })) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark all as read');
    }
  }

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Notifications" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Notifications {unreadCount > 0 && <span className="text-sm font-normal text-slate-500">({unreadCount} unread)</span>}
          </h2>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-sm font-medium text-slate-700 hover:underline">
              Mark all as read
            </button>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {notifications?.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg border p-4 ${n.isRead ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{n.subject}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{n.body}</p>
                  <p className="mt-2 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.isRead && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="shrink-0 text-xs font-medium text-slate-600 hover:underline"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
          {notifications?.length === 0 && (
            <p className="text-sm text-slate-500">No notifications yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
