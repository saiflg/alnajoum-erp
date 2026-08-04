'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency } from '@/lib/format';
import { Invoice } from '@/lib/types';

export default function FinanceDashboardPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  useEffect(() => {
    apiRequest<Invoice[]>('/invoices')
      .then(setInvoices)
      .catch(() => undefined);
  }, []);

  const outstanding = invoices?.filter(
    (inv) => inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID',
  );
  const outstandingBalance = outstanding?.reduce((sum, inv) => {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    return sum + (inv.totalAmount - paid);
  }, 0);

  return (
    <ProtectedRoute allowedRoles={['FINANCE_OFFICER']}>
      <AppShell title="Finance Dashboard" navLinks={FINANCE_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Reconciliation and BI reporting ship in later phases — invoicing and
          payment collection are live today.
        </p>

        <div className="mt-6 grid max-w-2xl grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Outstanding invoices</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {outstanding ? outstanding.length : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Outstanding balance</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {outstandingBalance !== undefined
                ? formatCurrency(outstandingBalance, 'NGN')
                : '—'}
            </p>
          </div>
        </div>

        <Link
          href="/admin/invoices"
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          View all invoices
        </Link>
      </AppShell>
    </ProtectedRoute>
  );
}
