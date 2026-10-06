'use client';

import { PageHeader } from '@/components/portal/PageHeader';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { useAuth } from '@/lib/auth-context';

export default function AdminDashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Admin Dashboard" navLinks={ADMIN_NAV}>
        <PageHeader scene="city" title={user ? `Welcome, ${user.email}` : 'Welcome'} subtitle="Phase 1 covers authentication, RBAC, and Company / Branch / Staff management. Use the navigation above to manage those records." />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { href: '/admin/companies', label: 'Manage Companies' },
            { href: '/admin/branches', label: 'Manage Branches' },
            { href: '/admin/staff', label: 'Manage Staff' },
          ].map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="rounded-lg border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
            >
              {card.label}
            </a>
          ))}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
