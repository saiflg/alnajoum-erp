'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { Invoice } from '@/lib/types';

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

export default function MyInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Invoice[]>('/invoices/me')
      .then(setInvoices)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="My Invoices" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">My Invoices</h2>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Invoice</th>
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
                      href={`/portal/invoices/${invoice.id}`}
                      className="font-medium text-slate-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {invoices?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No invoices yet.
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
