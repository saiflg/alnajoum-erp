'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { formatCurrency } from '@/lib/format';

/**
 * Stands in for a real gateway's hosted checkout page when
 * PAYMENT_PROVIDER=mock (the default — see MockPaymentProviderService).
 * Exists so the full redirect-out/redirect-back checkout flow is
 * genuinely exercisable without a real Paystack account: this page is
 * where the browser lands after POST /invoices/me/:id/checkout, and
 * clicking through sends it on to the real callback URL, exactly like a
 * real gateway would after a successful charge.
 */
function MockCheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const reference = searchParams.get('reference') ?? '';
  const amount = Number(searchParams.get('amount') ?? '0');
  const currency = searchParams.get('currency') ?? 'NGN';
  const callback = searchParams.get('callback');

  function handlePay() {
    if (!callback) {
      return;
    }
    setSubmitting(true);
    router.push(callback);
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="text-sm font-semibold text-slate-900">Secure Checkout</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Simulated checkout — no real gateway is configured yet
          (PAYMENT_PROVIDER=mock).
        </p>

        <div className="mt-6 rounded-md bg-slate-50 p-4">
          <p className="text-xs text-slate-500">Amount due</p>
          <p className="text-2xl font-bold text-slate-900">
            {formatCurrency(amount, currency)}
          </p>
          <p className="mt-2 text-xs text-slate-400">Reference: {reference}</p>
        </div>

        <button
          type="button"
          onClick={handlePay}
          disabled={submitting || !callback}
          className="mt-6 w-full rounded-md bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          {submitting ? 'Processing…' : 'Simulate successful payment'}
        </button>
      </div>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <MockCheckoutContent />
    </Suspense>
  );
}
