'use client';

import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';

export default function CustomerPortalDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell
        title="Customer Portal"
        navLinks={[{ href: '/portal/dashboard', label: 'Dashboard' }]}
      >
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Flight/hotel booking, visa applications, Hajj &amp; Umrah
          registration, and wallets ship in later phases.
        </p>
      </AppShell>
    </ProtectedRoute>
  );
}
