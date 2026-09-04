'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

type PayableStatus = 'OUTSTANDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

interface Payable {
  id: string;
  supplierName: string;
  sourceModule: string;
  sourceId: string;
  amount: number;
  amountPaid: number;
  currency: string;
  status: PayableStatus;
  dueDate: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<PayableStatus, string> = {
  OUTSTANDING: 'bg-slate-100 text-slate-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  OVERDUE: 'bg-red-100 text-red-800',
};

export default function SupplierPayablesPage() {
  const [payables, setPayables] = useState<Payable[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<PayableStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  function load() {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    apiRequest<Payable[]>(`/finance/supplier-payables${params}`)
      .then(setPayables)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load supplier payables'));
  }

  useEffect(load, [statusFilter]);

  async function handlePay(e: FormEvent, id: string) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest(`/finance/supplier-payables/${id}/payments`, {
        method: 'POST',
        body: { amount: Number(payAmount), paymentMethod: 'BANK_TRANSFER' },
      });
      setPayingId(null);
      setPayAmount('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record supplier payment');
    }
  }

  const totalOutstanding = payables?.reduce((s, p) => s + (p.amount - p.amountPaid), 0) ?? 0;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Supplier Payables" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Supplier Payables</h2>
        <p className="mt-1 text-sm text-slate-500">
          Auto-created when a flight is ticketed, a hotel booking completed, or a visa cost confirmed — pay them down here.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
          Total outstanding: <span className="font-semibold text-slate-900">{formatCurrency(totalOutstanding, 'NGN')}</span>
        </div>

        <div className="mt-4 flex gap-2">
          {(['', 'OUTSTANDING', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'] as const).map((s) => (
            <button
              key={s || 'ALL'}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Supplier</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Service</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Cost</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Paid</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Outstanding</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Due</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payables?.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{p.supplierName}</td>
                  <td className="px-3 py-2 text-slate-600">{p.sourceModule.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(p.amount, p.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(p.amountPaid, p.currency)}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">{formatCurrency(p.amount - p.amountPaid, p.currency)}</td>
                  <td className="px-3 py-2 text-slate-500">{p.dueDate ? formatDateTime(p.dueDate) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}>{p.status.replace('_', ' ')}</span>
                  </td>
                  <td className="px-3 py-2">
                    {p.status !== 'PAID' &&
                      (payingId === p.id ? (
                        <form onSubmit={(e) => handlePay(e, p.id)} className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={p.amount - p.amountPaid}
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            required
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button type="submit" className="text-emerald-600 hover:underline">
                            Pay
                          </button>
                          <button type="button" onClick={() => setPayingId(null)} className="text-slate-400 hover:underline">
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <button onClick={() => setPayingId(p.id)} className="text-blue-600 hover:underline">
                          Record payment
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
              {payables?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    No supplier payables.
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
