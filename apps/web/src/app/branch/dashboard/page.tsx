'use client';

import { PageHeader } from '@/components/portal/PageHeader';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';

export default function BranchDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['BRANCH_MANAGER']}>
      <AppShell
        title="Branch Dashboard"
        navLinks={[
          { href: '/branch/dashboard', label: 'Dashboard' },
          { href: '/admin/branches', label: 'Branches' },
          { href: '/admin/staff', label: 'Staff' },
        ]}
      >
        <PageHeader scene="desert" title={user ? `Welcome, ${user.email}` : 'Welcome'} subtitle="Branch operations (bookings, visa processing, incentives) ship in later phases. For now you can view branches and staff you have access to." />
      </AppShell>
    </ProtectedRoute>
  );
}
