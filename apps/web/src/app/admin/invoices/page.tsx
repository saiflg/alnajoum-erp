'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Invoice, InvoiceStatus } from '@/lib/types';

const STATUSES: Array<InvoiceStatus | ''> = ['', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

const STATUS_STYLES: Record<string, string> = {
  PAID: 'bg-green-100 text-green-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-700',
  ISSUED: 'bg-blue-100 text-blue-700',
  VOID: 'bg-slate-100 text-slate-500',
};

function balanceDue(invoice: Invoice): number {
  const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  return invoice.totalAmount - paid;
}

export default function AdminInvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<Invoice[]>(`/invoices?${params.toString()}`)
      .then(setInvoices)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [statusFilter]);

  const navLinks = user?.roles.includes('FINANCE_OFFICER') && user.roles.length === 1
    ? FINANCE_NAV
    : ADMIN_NAV;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Invoices" navLinks={navLinks}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Invoices</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace('_', ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Invoice</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Customer</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Date</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Total</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Balance due</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices?.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {invoice.invoiceNumber}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {invoice.customer
                      ? `${invoice.customer.firstName} ${invoice.customer.lastName}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatDateTime(invoice.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatCurrency(invoice.totalAmount, invoice.currency)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatCurrency(balanceDue(invoice), invoice.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[invoice.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {invoice.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/admin/invoices/${invoice.id}`}
                      className="font-medium text-slate-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {invoices?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={7}>
                    No invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
