'use client';

import { PageHeader } from '@/components/portal/PageHeader';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';

export default function StaffDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['STAFF']}>
      <AppShell title="Staff Dashboard" navLinks={[{ href: '/staff/dashboard', label: 'Dashboard' }]}>
        <PageHeader scene="sky" title={user ? `Welcome, ${user.email}` : 'Welcome'} subtitle="Flight/hotel/visa operations, incentives, and tasks ship in later phases." />
      </AppShell>
    </ProtectedRoute>
  );
}
