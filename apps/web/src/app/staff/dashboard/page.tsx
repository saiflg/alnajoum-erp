'use client';

import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';

export default function StaffDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['STAFF']}>
      <AppShell title="Staff Dashboard" navLinks={[{ href: '/staff/dashboard', label: 'Dashboard' }]}>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Flight/hotel/visa operations, incentives, and tasks ship in later
          phases.
        </p>
      </AppShell>
    </ProtectedRoute>
  );
}
