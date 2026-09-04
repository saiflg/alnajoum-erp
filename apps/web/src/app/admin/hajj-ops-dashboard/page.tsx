'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';

interface StatusCount {
  status: string;
  _count: number;
}

interface Dashboard {
  hajjGroupsByStatus: StatusCount[];
  umrahGroupsByStatus: StatusCount[];
  upcomingHajjDepartures: number;
  upcomingUmrahDepartures: number;
  checkInsToday: number;
  vehiclesAvailable: number;
  driversActive: number;
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function StatusBreakdown({ title, counts }: { title: string; counts: StatusCount[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {counts.map((c) => (
          <li key={c.status} className="flex justify-between">
            <span>{c.status.replace(/_/g, ' ')}</span>
            <span className="font-medium">{c._count}</span>
          </li>
        ))}
        {counts.length === 0 && <li className="text-slate-400">No groups yet.</li>}
      </ul>
    </div>
  );
}

export default function HajjOpsDashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Dashboard>('/hajj-ops/reports/dashboard')
      .then(setDashboard)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
  }, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Hajj & Umrah Operations" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Hajj &amp; Umrah Operations Center</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {dashboard && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Card label="Upcoming Hajj Departures (14d)" value={dashboard.upcomingHajjDepartures} />
              <Card label="Upcoming Umrah Departures (14d)" value={dashboard.upcomingUmrahDepartures} />
              <Card label="Check-ins Today" value={dashboard.checkInsToday} />
              <Card label="Vehicles Available" value={dashboard.vehiclesAvailable} />
              <Card label="Drivers Active" value={dashboard.driversActive} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatusBreakdown title="Hajj Groups by Status" counts={dashboard.hajjGroupsByStatus} />
              <StatusBreakdown title="Umrah Groups by Status" counts={dashboard.umrahGroupsByStatus} />
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
