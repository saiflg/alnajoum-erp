'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth-context';
import { PORTAL_NAV } from '@/lib/portal-nav';

export default function CustomerPortalDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Customer Portal" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Flight/hotel booking, visa applications, Hajj &amp; Umrah
          registration, and wallets ship in later phases.
        </p>
        <Link
          href="/portal/profile"
          className="mt-6 inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
        >
          Manage My Profile &amp; Documents
        </Link>
      </AppShell>
    </ProtectedRoute>
  );
}
