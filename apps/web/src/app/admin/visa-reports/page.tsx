'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

interface Kpis {
  totalApplications: number;
  pendingApplications: number;
  processing: number;
  approved: number;
  rejected: number;
  awaitingDocuments: number;
  awaitingGuarantor: number;
  completed: number;
  revenue: number;
  totalCost: number;
  totalMargin: number;
  staffIncentives: number;
  pendingIncentives: number;
  netProfit: number;
}

interface ProfitRow {
  applicationId: string;
  applicationReference: string;
  customer: string;
  visaType: string;
  destinationCountry: string;
  companyCost: number;
  sellingPrice: number;
  margin: number;
  staffIncentive: number;
  companyShare: number;
  otherFees: number;
  netProfit: number;
  paymentStatus: string;
  applicationStatus: string;
  staff: string | null;
  branch: string | null;
  date: string;
  currency: string;
}

const KPI_CARDS: { key: keyof Kpis; label: string; money?: boolean }[] = [
  { key: 'totalApplications', label: 'Total Applications' },
  { key: 'pendingApplications', label: 'Pending' },
  { key: 'processing', label: 'Processing' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'awaitingDocuments', label: 'Awaiting Documents' },
  { key: 'awaitingGuarantor', label: 'Awaiting Guarantor' },
  { key: 'completed', label: 'Completed' },
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'totalCost', label: 'Total Cost', money: true },
  { key: 'totalMargin', label: 'Total Margin', money: true },
  { key: 'staffIncentives', label: 'Staff Incentives', money: true },
  { key: 'pendingIncentives', label: 'Pending Incentives', money: true },
  { key: 'netProfit', label: 'Net Profit', money: true },
];

export default function AdminVisaReportsPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<ProfitRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    apiRequest<Kpis>(`/visa/reports/kpis?${params.toString()}`).then(setKpis).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    apiRequest<ProfitRow[]>(`/visa/reports/profit?${params.toString()}`).then(setRows).catch(() => undefined);
  }

  useEffect(load, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Visa Reports" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Visa Profitability</h2>
          <div className="flex items-end gap-2">
            <label className="text-xs text-slate-500">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button onClick={load} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Apply
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {kpis &&
            KPI_CARDS.map(({ key, label, money }) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {money ? formatCurrency(kpis[key], 'NGN') : kpis[key]}
                </p>
              </div>
            ))}
        </div>

        <h3 className="mt-8 text-sm font-semibold text-slate-900">Per-Application Profit Report</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Reference</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Customer</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Visa</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Cost</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Selling</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Margin</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Incentive</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Net Profit</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Payment</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Staff</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows?.map((r) => (
                <tr key={r.applicationId}>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.applicationReference}</td>
                  <td className="px-3 py-2 text-slate-600">{r.customer}</td>
                  <td className="px-3 py-2 text-slate-600">{r.destinationCountry} — {r.visaType}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.companyCost, r.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.sellingPrice, r.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.margin, r.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.staffIncentive, r.currency)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${r.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatCurrency(r.netProfit, r.currency)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.paymentStatus}</td>
                  <td className="px-3 py-2 text-slate-600">{r.applicationStatus.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-slate-600">{r.staff ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(r.date)}</td>
                </tr>
              ))}
              {rows?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={12}>No data for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
