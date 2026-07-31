'use client';

import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';

export default function FinanceDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['FINANCE_OFFICER']}>
      <AppShell
        title="Finance Dashboard"
        navLinks={[{ href: '/finance/dashboard', label: 'Dashboard' }]}
      >
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Finance &amp; Accounting, reconciliation, and BI reporting ship in
          later phases.
        </p>
      </AppShell>
    </ProtectedRoute>
  );
}
