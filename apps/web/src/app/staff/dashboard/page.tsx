'use client';

import { PageHeader } from '@/components/portal/PageHeader';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';
import { STAFF_NAV } from '@/lib/nav-for-roles';

export default function StaffDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['STAFF']}>
      <AppShell title="Staff Dashboard" navLinks={STAFF_NAV}>
        <PageHeader scene="sky" title={user ? `Welcome, ${user.email}` : 'Welcome'} subtitle="Flight/hotel/visa operations, incentives, and tasks ship in later phases." />
      </AppShell>
    </ProtectedRoute>
  );
}
