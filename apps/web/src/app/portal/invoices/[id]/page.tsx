'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { Invoice } from '@/lib/types';

function InvoiceDetailContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingOnline, setPayingOnline] = useState(false);
  const [payingWithWallet, setPayingWithWallet] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);

  const loadInvoice = useCallback(() => {
    return apiRequest<Invoice>(`/invoices/me/${params.id}`)
      .then(setInvoice)
      .catch((err) => setError(err.message));
  }, [params.id]);

  useEffect(() => {
    // Skip the initial fetch when we're about to verify a just-completed
    // checkout below — that effect sets the freshest invoice itself once
    // verification resolves. Firing both here would race: whichever
    // response (this plain GET or the verify POST) resolves last wins,
    // and the GET can easily land after the verify and silently overwrite
    // the confirmed PAID state with the stale pre-payment snapshot it
    // fetched before the payment was ever recorded.
    if (searchParams.get('checkout_reference')) return;
    void loadInvoice();
  }, [loadInvoice, searchParams]);

  useEffect(() => {
    apiRequest<{ balance: number }>('/wallet/me')
      .then((data) => setWalletBalance(data.balance))
      .catch(() => undefined);
  }, []);

  // Returning from the mock/real checkout page lands back here with
  // ?checkout_reference=... — confirm it once, then strip the query param
  // so a page refresh doesn't try to re-verify an already-settled payment.
  useEffect(() => {
    const reference = searchParams.get('checkout_reference');
    if (!reference) {
      return;
    }
    let ignore = false;
    // This is the same "confirm on mount" idiom as auth-context.tsx's
    // session check: a one-time verification that must run as soon as the
    // browser lands back from checkout. react-hooks/set-state-in-effect
    // wants Suspense/an external store for this, which isn't warranted
    // here — the `ignore` guard below already prevents the real hazard (a
    // stray update after unmount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerifying(true);
    apiRequest<Invoice>(`/invoices/me/${params.id}/checkout/verify`, {
      method: 'POST',
      body: { reference },
    })
      .then((updated) => {
        if (ignore) return;
        setInvoice(updated);
        setPaymentNotice({ kind: 'success', message: 'Payment confirmed — thank you!' });
      })
      .catch((err) => {
        if (ignore) return;
        setPaymentNotice({
          kind: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'We could not confirm this payment. If you were charged, contact us and we will sort it out.',
        });
      })
      .finally(() => {
        if (ignore) return;
        setVerifying(false);
        router.replace(`/portal/invoices/${params.id}`);
      });
    return () => {
      ignore = true;
    };
    // Only run once, off the reference present at mount — router.replace()
    // above removes it from the URL, so this intentionally doesn't re-run
    // as params/router identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePayOnline() {
    setPayingOnline(true);
    setPaymentNotice(null);
    try {
      const result = await apiRequest<{ authorizationUrl: string }>(
        `/invoices/me/${params.id}/checkout`,
        { method: 'POST' },
      );
      window.location.href = result.authorizationUrl;
    } catch (err) {
      setPaymentNotice({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not start checkout',
      });
      setPayingOnline(false);
    }
  }

  async function handlePayWithWallet() {
    if (!invoice) return;
    setPayingWithWallet(true);
    setPaymentNotice(null);
    try {
      const updated = await apiRequest<Invoice>('/wallet/me/pay-invoice', {
        method: 'POST',
        body: { invoiceId: invoice.id, amount: balance },
      });
      setInvoice(updated);
      setPaymentNotice({ kind: 'success', message: 'Paid from your wallet balance — thank you!' });
      const wallet = await apiRequest<{ balance: number }>('/wallet/me');
      setWalletBalance(wallet.balance);
    } catch (err) {
      setPaymentNotice({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not pay with wallet balance',
      });
    } finally {
      setPayingWithWallet(false);
    }
  }

  const paid = invoice?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const balance = invoice ? invoice.totalAmount - paid : 0;
  const canPayOnline = invoice && balance > 0 && invoice.status !== 'VOID';
  const canPayWithWallet = canPayOnline && walletBalance !== null && walletBalance >= balance;

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Invoice Detail" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {verifying && (
          <p className="mb-4 text-sm text-slate-500">Confirming your payment…</p>
        )}
        {paymentNotice && (
          <p
            className={`mb-4 text-sm ${paymentNotice.kind === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {paymentNotice.message}
          </p>
        )}

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

              {canPayOnline && (
                <button
                  type="button"
                  onClick={handlePayOnline}
                  disabled={payingOnline}
                  className="mt-4 w-full rounded-md bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
                >
                  {payingOnline ? 'Redirecting to checkout…' : 'Pay online'}
                </button>
              )}
              {canPayOnline && (
                <button
                  type="button"
                  onClick={handlePayWithWallet}
                  disabled={payingWithWallet || !canPayWithWallet}
                  title={
                    !canPayWithWallet && walletBalance !== null
                      ? `Wallet balance (${walletBalance.toLocaleString()}) is less than the balance due`
                      : undefined
                  }
                  className="mt-2 w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  {payingWithWallet
                    ? 'Paying from wallet…'
                    : `Pay with wallet balance${walletBalance !== null ? ` (${formatCurrency(walletBalance, invoice.currency)})` : ''}`}
                </button>
              )}
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}

export default function InvoiceDetailPage() {
  return (
    <Suspense fallback={null}>
      <InvoiceDetailContent />
    </Suspense>
  );
}
