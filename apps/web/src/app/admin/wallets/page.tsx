'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { Wallet } from '@/lib/types';

type WalletRow = Wallet & { balance: number };

export default function AdminWalletsPage() {
  const [wallets, setWallets] = useState<WalletRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [showTransfer, setShowTransfer] = useState(false);
  const [fromCustomerId, setFromCustomerId] = useState('');
  const [toCustomerId, setToCustomerId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('');
  const [transferring, setTransferring] = useState(false);

  function load() {
    apiRequest<WalletRow[]>('/wallet')
      .then(setWallets)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  function openCreditForm(customerId: string) {
    setOpenCustomerId(openCustomerId === customerId ? null : customerId);
    setAmount('');
    setDescription('');
  }

  async function handleCredit(e: FormEvent, customerId: string) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/wallet/${customerId}/credit`, {
        method: 'POST',
        body: { amount: Number(amount), description: description || undefined },
      });
      setOpenCustomerId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to credit wallet');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransfer(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setTransferring(true);
    try {
      await apiRequest('/wallet/transfer', {
        method: 'POST',
        body: {
          fromCustomerId,
          toCustomerId,
          amount: Number(transferAmount),
          description: transferDescription,
        },
      });
      setShowTransfer(false);
      setFromCustomerId('');
      setToCustomerId('');
      setTransferAmount('');
      setTransferDescription('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to transfer between wallets');
    } finally {
      setTransferring(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Wallets" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Customer Wallets</h2>
            <p className="mt-1 text-sm text-slate-500">
              Manually credit a wallet for a cash/bank-transfer deposit made at the branch.
            </p>
          </div>
          <button
            onClick={() => setShowTransfer((v) => !v)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {showTransfer ? 'Cancel' : 'Transfer between wallets'}
          </button>
        </div>

        {showTransfer && (
          <form
            onSubmit={handleTransfer}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
          >
            <select
              required
              value={fromCustomerId}
              onChange={(e) => setFromCustomerId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— From customer —</option>
              {wallets?.map((w) => (
                <option key={w.customerId} value={w.customerId}>
                  {w.customer?.firstName} {w.customer?.lastName} ({formatCurrency(w.balance, w.currency)})
                </option>
              ))}
            </select>
            <select
              required
              value={toCustomerId}
              onChange={(e) => setToCustomerId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— To customer —</option>
              {wallets?.map((w) => (
                <option key={w.customerId} value={w.customerId}>
                  {w.customer?.firstName} {w.customer?.lastName}
                </option>
              ))}
            </select>
            <input
              required
              type="number"
              min={1}
              placeholder="Amount (₦)"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Reason for transfer"
              value={transferDescription}
              onChange={(e) => setTransferDescription(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={transferring || fromCustomerId === toCustomerId}
              className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-4"
            >
              {transferring ? 'Transferring…' : 'Transfer'}
            </button>
            {fromCustomerId && fromCustomerId === toCustomerId && (
              <p className="col-span-2 text-xs text-red-600 sm:col-span-4">
                Source and destination must be different customers.
              </p>
            )}
          </form>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Customer</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Balance</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wallets?.map((wallet) => (
                <tr key={wallet.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {wallet.customer?.firstName} {wallet.customer?.lastName}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-700">
                    {formatCurrency(wallet.balance, wallet.currency)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => openCreditForm(wallet.customerId)}
                      className="text-sm font-medium text-slate-700 hover:underline"
                    >
                      {openCustomerId === wallet.customerId ? 'Cancel' : 'Credit wallet'}
                    </button>
                  </td>
                </tr>
              ))}
              {wallets?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={3}>
                    No customer wallets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {openCustomerId && (
          <form
            onSubmit={(e) => handleCredit(e, openCustomerId)}
            className="mt-4 flex max-w-xl items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700">Amount (₦)</label>
              <input
                required
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Cash deposit at branch"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Crediting…' : 'Credit'}
            </button>
          </form>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
