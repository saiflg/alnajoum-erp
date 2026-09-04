'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

interface Account {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'EQUITY';
  isSystem: boolean;
  isActive: boolean;
}

interface TrialBalanceRow {
  code: string;
  name: string;
  type: Account['type'];
  balance: number;
}

interface JournalEntry {
  id: string;
  amount: number;
  currency: string;
  reference: string;
  description: string;
  sourceModule: string;
  sourceId: string | null;
  status: 'POSTED' | 'REVERSED';
  createdAt: string;
  debitAccount: { code: string; name: string };
  creditAccount: { code: string; name: string };
}

const TYPE_ORDER: Account['type'][] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export default function ChartOfAccountsPage() {
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[] | null>(null);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('EXPENSE');
  const [creating, setCreating] = useState(false);

  function load() {
    apiRequest<TrialBalanceRow[]>('/finance/accounts/trial-balance')
      .then(setTrialBalance)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load chart of accounts'));
    apiRequest<JournalEntry[]>('/finance/accounts/journal-entries').then(setEntries).catch(() => undefined);
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiRequest('/finance/accounts', { method: 'POST', body: { code, name, type } });
      setCode('');
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create account');
    } finally {
      setCreating(false);
    }
  }

  const assetTotal = trialBalance?.filter((a) => a.type === 'ASSET').reduce((s, a) => s + a.balance, 0) ?? 0;
  const liabilityAndEquity =
    trialBalance?.filter((a) => a.type === 'LIABILITY' || a.type === 'EQUITY').reduce((s, a) => s + a.balance, 0) ?? 0;
  const netIncome =
    (trialBalance?.filter((a) => a.type === 'REVENUE').reduce((s, a) => s + a.balance, 0) ?? 0) -
    (trialBalance?.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + a.balance, 0) ?? 0);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Chart of Accounts" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Chart of Accounts &amp; General Ledger</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="text-slate-600">
            Assets: <span className="font-semibold text-slate-900">{formatCurrency(assetTotal, 'NGN')}</span> ·
            {' '}Liabilities + Equity: <span className="font-semibold text-slate-900">{formatCurrency(liabilityAndEquity, 'NGN')}</span> ·
            {' '}Net Income (Revenue − Expense): <span className="font-semibold text-slate-900">{formatCurrency(netIncome, 'NGN')}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Assets should equal Liabilities + Equity + Net Income once every entry is posted — the ledger enforces this structurally (every entry balances by construction), so a mismatch here would indicate a bug, not an accounting error.
          </p>
        </div>

        <form onSubmit={handleCreate} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-xs text-slate-500">
            Code
            <input value={code} onChange={(e) => setCode(e.target.value)} required className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 block w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as Account['type'])} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={creating} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            Add account
          </button>
        </form>

        {TYPE_ORDER.map((t) => {
          const rows = trialBalance?.filter((a) => a.type === t) ?? [];
          if (rows.length === 0) return null;
          return (
            <div key={t} className="mt-6">
              <h3 className="text-sm font-semibold text-slate-900">{t.charAt(0) + t.slice(1).toLowerCase()}</h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Code</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((a) => (
                      <tr key={a.code}>
                        <td className="px-3 py-2 font-mono text-slate-500">{a.code}</td>
                        <td className="px-3 py-2 text-slate-800">{a.name}</td>
                        <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(a.balance, 'NGN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        <h3 className="mt-8 text-sm font-semibold text-slate-900">Recent Journal Entries</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Debit</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Credit</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Description</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Source</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries?.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(e.createdAt)}</td>
                  <td className="px-3 py-2 text-slate-700">{e.debitAccount.code} {e.debitAccount.name}</td>
                  <td className="px-3 py-2 text-slate-700">{e.creditAccount.code} {e.creditAccount.name}</td>
                  <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(e.amount, e.currency)}</td>
                  <td className="px-3 py-2 text-slate-600">{e.description}</td>
                  <td className="px-3 py-2 text-slate-500">{e.sourceModule}</td>
                  <td className="px-3 py-2">
                    <span className={e.status === 'REVERSED' ? 'text-red-600' : 'text-emerald-600'}>{e.status}</span>
                  </td>
                </tr>
              ))}
              {entries?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    No journal entries yet.
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
