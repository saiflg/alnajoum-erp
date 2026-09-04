'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import type { NavLink } from '@/components/AppShell';

interface DashboardKpis {
  totalRevenue: number;
  grossProfit: number;
  netProfit: number;
  totalExpenses: number;
  cashPosition: number;
  bankPosition: number;
  customerWalletLiability: number;
  staffIncentivePayable: number;
  supplierPayables: number;
  companyInvestmentPosition: number;
  incentivesPending: { count: number; amount: number };
  incentivesApproved: { count: number; amount: number };
  payoutsPending: { count: number; amount: number };
  payoutsSuccessful: { count: number; amount: number };
  refunds: number;
  cashFlowNet: number;
}

interface ProfitAndLoss {
  totalRevenue: number;
  revenueLines: { code: string; name: string; amount: number }[];
  costOfServices: number;
  grossProfit: number;
  operatingExpenseLines: { code: string; name: string; amount: number }[];
  totalOperatingExpenses: number;
  operatingProfit: number;
  otherExpenseLines: { code: string; name: string; amount: number }[];
  totalOtherExpenses: number;
  netProfit: number;
}

interface CashFlow {
  inflow: number;
  outflow: number;
  net: number;
  inflowBySource: Record<string, number>;
  outflowBySource: Record<string, number>;
}

interface BranchRow {
  branchId: string;
  branchName: string;
  revenue: number;
  expenses: number;
  staffIncentives: number;
  profit: number;
}

const KPI_CARDS: { key: keyof DashboardKpis; label: string }[] = [
  { key: 'totalRevenue', label: 'Total Revenue' },
  { key: 'grossProfit', label: 'Gross Profit' },
  { key: 'netProfit', label: 'Net Profit' },
  { key: 'totalExpenses', label: 'Total Expenses' },
  { key: 'cashPosition', label: 'Cash Position' },
  { key: 'bankPosition', label: 'Bank Position' },
  { key: 'customerWalletLiability', label: 'Customer Wallet Liability' },
  { key: 'staffIncentivePayable', label: 'Staff Incentive Payable' },
  { key: 'supplierPayables', label: 'Supplier Payables' },
  { key: 'companyInvestmentPosition', label: 'Company Investment' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'cashFlowNet', label: 'Net Cash Flow' },
];

export default function FinanceDashboardPage() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const nav: NavLink[] =
    roles.includes('FINANCE_OFFICER') && !roles.some((r) => ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(r))
      ? FINANCE_NAV
      : ADMIN_NAV;

  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [pl, setPl] = useState<ProfitAndLoss | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [branches, setBranches] = useState<BranchRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();

    apiRequest<DashboardKpis>('/finance/reports/dashboard')
      .then(setKpis)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
    apiRequest<ProfitAndLoss>(`/finance/reports/profit-and-loss${qs ? `?${qs}` : ''}`).then(setPl).catch(() => undefined);
    apiRequest<CashFlow>(`/finance/reports/cash-flow${qs ? `?${qs}` : ''}`).then(setCashFlow).catch(() => undefined);
    apiRequest<BranchRow[]>('/finance/reports/branches').then(setBranches).catch(() => undefined);
  }

  useEffect(load, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Finance Dashboard" navLinks={nav}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Enterprise Finance Dashboard</h2>
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

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {kpis &&
            KPI_CARDS.map(({ key, label }) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(kpis[key] as number, 'NGN')}</p>
              </div>
            ))}
        </div>

        {kpis && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-700">Incentives Pending</p>
              <p className="mt-1 text-base font-semibold text-amber-900">
                {kpis.incentivesPending.count} · {formatCurrency(kpis.incentivesPending.amount, 'NGN')}
              </p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs text-blue-700">Incentives Approved</p>
              <p className="mt-1 text-base font-semibold text-blue-900">
                {kpis.incentivesApproved.count} · {formatCurrency(kpis.incentivesApproved.amount, 'NGN')}
              </p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs text-orange-700">Payouts Pending</p>
              <p className="mt-1 text-base font-semibold text-orange-900">
                {kpis.payoutsPending.count} · {formatCurrency(kpis.payoutsPending.amount, 'NGN')}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">Payouts Successful</p>
              <p className="mt-1 text-base font-semibold text-emerald-900">
                {kpis.payoutsSuccessful.count} · {formatCurrency(kpis.payoutsSuccessful.amount, 'NGN')}
              </p>
            </div>
          </div>
        )}

        {pl && (
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Profit &amp; Loss</h3>
              <dl className="mt-3 space-y-1 text-sm">
                {pl.revenueLines.filter((l) => l.amount !== 0).map((l) => (
                  <div key={l.code} className="flex justify-between text-slate-600">
                    <dt>{l.name}</dt>
                    <dd>{formatCurrency(l.amount, 'NGN')}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-100 pt-1 font-medium text-slate-800">
                  <dt>Total Revenue</dt>
                  <dd>{formatCurrency(pl.totalRevenue, 'NGN')}</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>− Cost of Services</dt>
                  <dd>{formatCurrency(pl.costOfServices, 'NGN')}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1 font-medium text-slate-800">
                  <dt>Gross Profit</dt>
                  <dd>{formatCurrency(pl.grossProfit, 'NGN')}</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>− Operating Expenses</dt>
                  <dd>{formatCurrency(pl.totalOperatingExpenses, 'NGN')}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1 font-medium text-slate-800">
                  <dt>Operating Profit</dt>
                  <dd>{formatCurrency(pl.operatingProfit, 'NGN')}</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>− Other Expenses / Refunds</dt>
                  <dd>{formatCurrency(pl.totalOtherExpenses, 'NGN')}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-slate-900">
                  <dt>Net Profit</dt>
                  <dd>{formatCurrency(pl.netProfit, 'NGN')}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Cash Flow</h3>
              {cashFlow && (
                <>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between text-emerald-700">
                      <dt>Total Inflow</dt>
                      <dd>{formatCurrency(cashFlow.inflow, 'NGN')}</dd>
                    </div>
                    <div className="flex justify-between text-red-700">
                      <dt>Total Outflow</dt>
                      <dd>{formatCurrency(cashFlow.outflow, 'NGN')}</dd>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-slate-900">
                      <dt>Net Cash Flow</dt>
                      <dd>{formatCurrency(cashFlow.net, 'NGN')}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-medium text-slate-600">Inflow by source</p>
                      {Object.entries(cashFlow.inflowBySource).map(([source, amount]) => (
                        <div key={source} className="flex justify-between text-slate-500">
                          <span>{source}</span>
                          <span>{formatCurrency(amount, 'NGN')}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="font-medium text-slate-600">Outflow by source</p>
                      {Object.entries(cashFlow.outflowBySource).map(([source, amount]) => (
                        <div key={source} className="flex justify-between text-slate-500">
                          <span>{source}</span>
                          <span>{formatCurrency(amount, 'NGN')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {branches && branches.length > 0 && (
          <>
            <h3 className="mt-8 text-sm font-semibold text-slate-900">Branch Accounting</h3>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Branch</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">Revenue</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">Expenses</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">Staff Incentives</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {branches.map((b) => (
                    <tr key={b.branchId}>
                      <td className="px-3 py-2 font-medium text-slate-800">{b.branchName}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(b.revenue, 'NGN')}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(b.expenses, 'NGN')}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(b.staffIncentives, 'NGN')}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-800">{formatCurrency(b.profit, 'NGN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
