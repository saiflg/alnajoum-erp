'use client';

import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Invoice, PaymentMethod } from '@/lib/types';

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'POS', 'CARD', 'OTHER'];

export default function AdminInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');

  const canRecordPayment = !!user?.permissions.includes('payment:record');

  function load() {
    apiRequest<Invoice>(`/invoices/${params.id}`)
      .then(setInvoice)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [params.id]);

  const paid = invoice?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const balance = invoice ? invoice.totalAmount - paid : 0;

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest(`/invoices/${params.id}/payments`, {
        method: 'POST',
        body: { amount: parsedAmount, method, note: note || undefined },
      });
      setAmount('');
      setNote('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  const navLinks = user?.roles.includes('FINANCE_OFFICER') && user.roles.length === 1
    ? FINANCE_NAV
    : ADMIN_NAV;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Invoice Detail" navLinks={navLinks}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {invoice && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">{invoice.invoiceNumber}</h2>
            {invoice.customer && (
              <p className="text-sm text-slate-500">
                {invoice.customer.firstName} {invoice.customer.lastName}
              </p>
            )}
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

            {canRecordPayment && (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') && (
              <form
                onSubmit={handleRecordPayment}
                className="mt-6 max-w-2xl rounded-lg border border-slate-200 bg-white p-4"
              >
                <h3 className="text-sm font-semibold text-slate-900">Record a payment</h3>
                {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Amount</label>
                    <input
                      required
                      type="number"
                      min={1}
                      max={balance}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={String(balance)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Method</label>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Note (optional)</label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {submitting ? 'Recording…' : 'Record payment'}
                </button>
              </form>
            )}
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
