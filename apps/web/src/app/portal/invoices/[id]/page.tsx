'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { Invoice } from '@/lib/types';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Invoice>(`/invoices/me/${params.id}`)
      .then(setInvoice)
      .catch((err) => setError(err.message));
  }, [params.id]);

  const paid = invoice?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const balance = invoice ? invoice.totalAmount - paid : 0;

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Invoice Detail" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {invoice && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">{invoice.invoiceNumber}</h2>
            <p className="text-sm text-slate-500">
              Issued {formatDateTime(invoice.createdAt)} · Status: {invoice.status.replace('_', ' ')}
            </p>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Line items</h3>
            <div className="mt-2 max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Description</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.lineItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2 text-slate-700">{item.description}</td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {formatCurrency(item.amount, invoice.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Payments</h3>
            {invoice.payments.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <div className="mt-2 max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">Reference</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">Method</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-600">Date</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-4 py-2 text-slate-700">{payment.paymentReference}</td>
                        <td className="px-4 py-2 text-slate-600">{payment.method.replace('_', ' ')}</td>
                        <td className="px-4 py-2 text-slate-600">{formatDateTime(payment.paidAt)}</td>
                        <td className="px-4 py-2 text-right text-slate-700">
                          {formatCurrency(payment.amount, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-6 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Total</span>
                <span>{formatCurrency(invoice.totalAmount, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Paid</span>
                <span>{formatCurrency(paid, invoice.currency)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
                <span>Balance due</span>
                <span>{formatCurrency(balance, invoice.currency)}</span>
              </div>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
