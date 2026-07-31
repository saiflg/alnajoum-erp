'use client';

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
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Branch operations (bookings, visa processing, incentives) ship in
          later phases. For now you can view branches and staff you have
          access to.
        </p>
      </AppShell>
    </ProtectedRoute>
  );
}
