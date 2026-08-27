'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { WalletWithBalance } from '@/lib/types';

function WalletPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [data, setData] = useState<WalletWithBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(() => {
    return apiRequest<WalletWithBalance>('/wallet/me')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reference = searchParams.get('checkout_reference');
    if (!reference) return;
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerifying(true);
    apiRequest<WalletWithBalance>('/wallet/me/deposit/verify', {
      method: 'POST',
      body: { reference },
    })
      .then((updated) => {
        if (ignore) return;
        setData(updated);
        setNotice({ kind: 'success', message: 'Deposit confirmed — your wallet has been credited.' });
      })
      .catch((err) => {
        if (ignore) return;
        setNotice({
          kind: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'We could not confirm this deposit. If you were charged, contact us.',
        });
      })
      .finally(() => {
        if (ignore) return;
        setVerifying(false);
        router.replace('/portal/wallet');
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDeposit(e: FormEvent) {
    e.preventDefault();
    const amount = Number(depositAmount);
    if (!amount || amount < 100) {
      setError('Enter an amount of at least ₦100');
      return;
    }
    setError(null);
    setDepositing(true);
    try {
      const result = await apiRequest<{ authorizationUrl: string }>('/wallet/me/deposit', {
        method: 'POST',
        body: { amount },
      });
      window.location.href = result.authorizationUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start deposit');
      setDepositing(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Wallet" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {verifying && <p className="mb-4 text-sm text-slate-500">Confirming your deposit…</p>}
        {notice && (
          <p className={`mb-4 text-sm ${notice.kind === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
            {notice.message}
          </p>
        )}

        <h2 className="text-lg font-semibold text-slate-900">My Wallet</h2>

        {data && (
          <>
            <div className="mt-4 max-w-sm rounded-lg border border-slate-200 bg-white p-6">
              <p className="text-sm text-slate-500">Available balance</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">
                {formatCurrency(data.balance, data.wallet.currency)}
              </p>
            </div>

            <form onSubmit={handleDeposit} className="mt-6 flex max-w-md items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700">Top up amount (₦)</label>
                <input
                  type="number"
                  min={100}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="e.g. 50000"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={depositing}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {depositing ? 'Redirecting…' : 'Deposit online'}
              </button>
            </form>

            <h3 className="mt-8 text-sm font-semibold text-slate-900">Transaction history</h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Reference</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Description</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Date</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.transactions.map((txn) => (
                    <tr key={txn.id}>
                      <td className="px-4 py-2 text-slate-700">{txn.reference}</td>
                      <td className="px-4 py-2 text-slate-600">{txn.type.replace('_', ' ')}</td>
                      <td className="px-4 py-2 text-slate-600">{txn.description}</td>
                      <td className="px-4 py-2 text-slate-600">{txn.status}</td>
                      <td className="px-4 py-2 text-slate-500">{formatDateTime(txn.createdAt)}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium ${txn.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                      >
                        {txn.amount >= 0 ? '+' : ''}
                        {formatCurrency(txn.amount, txn.currency)}
                      </td>
                    </tr>
                  ))}
                  {data.transactions.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                        No wallet transactions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}

export default function WalletPage() {
  return (
    <Suspense fallback={null}>
      <WalletPageContent />
    </Suspense>
  );
}
