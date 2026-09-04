'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

type InvestmentType = 'INITIAL' | 'ADDITIONAL' | 'WITHDRAWAL';

interface Investment {
  id: string;
  type: InvestmentType;
  amount: number;
  currency: string;
  investor: string;
  date: string;
  description: string | null;
}

interface Position {
  initial: number;
  additional: number;
  withdrawals: number;
  totalInvested: number;
}

export default function InvestmentsPage() {
  const [investments, setInvestments] = useState<Investment[] | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<InvestmentType>('ADDITIONAL');
  const [amount, setAmount] = useState('');
  const [investor, setInvestor] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    apiRequest<Investment[]>('/finance/investments')
      .then(setInvestments)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load investments'));
    apiRequest<Position>('/finance/investments/position').then(setPosition).catch(() => undefined);
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/finance/investments', {
        method: 'POST',
        body: { type, amount: Number(amount), investor, date, description: description || undefined },
      });
      setAmount('');
      setInvestor('');
      setDescription('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record investment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Company Investment" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Company Investment Tracker</h2>
        <p className="mt-1 text-sm text-slate-500">
          Equity, not revenue — investment and operating profit are kept as distinct concepts everywhere in the finance reports.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {position && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">Initial Investment</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(position.initial, 'NGN')}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">Additional Investment</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(position.additional, 'NGN')}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">Withdrawals</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(position.withdrawals, 'NGN')}</p>
            </div>
            <div className="rounded-lg border border-slate-900 bg-slate-900 p-3">
              <p className="text-xs text-slate-300">Current Financial Position</p>
              <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(position.totalInvested, 'NGN')}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleCreate} className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-500">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as InvestmentType)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="INITIAL">Initial Investment</option>
              <option value="ADDITIONAL">Additional Investment</option>
              <option value="WITHDRAWAL">Withdrawal</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Amount (NGN)
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Investor
            <input value={investor} onChange={(e) => setInvestor(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              Record
            </button>
          </div>
        </form>

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Investor</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {investments?.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{inv.type}</td>
                  <td className="px-3 py-2 text-slate-600">{inv.investor}</td>
                  <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(inv.amount, inv.currency)}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(inv.date)}</td>
                  <td className="px-3 py-2 text-slate-600">{inv.description ?? '—'}</td>
                </tr>
              ))}
              {investments?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                    No investments recorded.
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
