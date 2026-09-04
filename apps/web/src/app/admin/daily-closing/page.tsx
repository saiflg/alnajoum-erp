'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

interface Summary {
  businessDate: string;
  cash: number;
  bankTransfer: number;
  pos: number;
  card: number;
  online: number;
  wallet: number;
  totalPayments: number;
  walletMovement: number;
  refunds: number;
  expensesPaid: number;
  staffPayouts: number;
  supplierPayments: number;
}

interface Closing {
  id: string;
  businessDate: string;
  closedAt: string;
  closedByStaff: { firstName: string; lastName: string };
  branch: { name: string } | null;
  summary: Summary;
}

type NumericSummaryKey = Exclude<keyof Summary, 'businessDate'>;

const SUMMARY_ROWS: { key: NumericSummaryKey; label: string }[] = [
  { key: 'cash', label: 'Cash Payments' },
  { key: 'bankTransfer', label: 'Bank Transfer Payments' },
  { key: 'pos', label: 'POS Payments' },
  { key: 'online', label: 'Online Payments' },
  { key: 'wallet', label: 'Wallet Payments' },
  { key: 'totalPayments', label: 'Total Payments' },
  { key: 'walletMovement', label: 'Wallet Transaction Movement' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'expensesPaid', label: 'Expenses Paid' },
  { key: 'staffPayouts', label: 'Staff Payouts' },
  { key: 'supplierPayments', label: 'Supplier Payments' },
];

export default function DailyClosingPage() {
  const [preview, setPreview] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Closing[] | null>(null);
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  function loadPreview() {
    apiRequest<Summary>(`/finance/daily-closing/preview?businessDate=${businessDate}`)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load preview'));
  }
  function loadHistory() {
    apiRequest<Closing[]>('/finance/daily-closing').then(setHistory).catch(() => undefined);
  }

  useEffect(loadPreview, [businessDate]);
  useEffect(loadHistory, []);

  async function handleClose() {
    setClosing(true);
    setError(null);
    try {
      await apiRequest('/finance/daily-closing', { method: 'POST', body: { businessDate } });
      loadPreview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to close the day');
    } finally {
      setClosing(false);
    }
  }

  const alreadyClosed = history?.some((c) => c.businessDate.slice(0, 10) === businessDate);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Daily Closing" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Daily Financial Closing</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex items-end gap-3">
          <label className="text-xs text-slate-500">
            Business date
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <button
            onClick={handleClose}
            disabled={closing || alreadyClosed}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {alreadyClosed ? 'Already closed' : 'Close this day'}
          </button>
        </div>

        {preview && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SUMMARY_ROWS.map(({ key, label }) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-base font-semibold text-slate-900">{formatCurrency(preview[key], 'NGN')}</p>
              </div>
            ))}
          </div>
        )}

        <h3 className="mt-8 text-sm font-semibold text-slate-900">Closing History</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Business Date</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Total Payments</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Closed By</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Closed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history?.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{c.businessDate.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(c.summary.totalPayments, 'NGN')}</td>
                  <td className="px-3 py-2 text-slate-600">{c.closedByStaff.firstName} {c.closedByStaff.lastName}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(c.closedAt)}</td>
                </tr>
              ))}
              {history?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                    No closed business days yet.
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
