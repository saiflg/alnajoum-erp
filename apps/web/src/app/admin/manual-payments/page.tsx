'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { CustomerProfile, Invoice, ManualPaymentSubmission, PaymentMethod } from '@/lib/types';

const MANUAL_METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER'];

function SubmitManualPaymentForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [bankName, setBankName] = useState('');
  const [transactionReference, setTransactionReference] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<CustomerProfile[]>('/customers').then(setCustomers).catch(() => undefined);
  }, []);

  // Reset the invoice list/selection the instant the chosen customer changes (including
  // back to "none"), rather than in the fetch effect below — calling setState directly in
  // an effect body risks cascading renders, so this follows React's documented pattern for
  // adjusting state during render when a dependency changes.
  const [invoicesLoadedFor, setInvoicesLoadedFor] = useState('');
  if (customerId !== invoicesLoadedFor && !customerId) {
    setInvoicesLoadedFor(customerId);
    setInvoices([]);
    setInvoiceId('');
  }

  useEffect(() => {
    if (!customerId) {
      return;
    }
    apiRequest<Invoice[]>(`/invoices?customerId=${customerId}`)
      .then((data) => {
        setInvoices(data.filter((inv) => inv.status !== 'PAID' && inv.status !== 'VOID'));
        setInvoiceId('');
        setInvoicesLoadedFor(customerId);
      })
      .catch(() => undefined);
  }, [customerId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/manual-payments', {
        method: 'POST',
        body: {
          customerId,
          invoiceId,
          amount: Number(amount),
          method,
          bankName: bankName || undefined,
          transactionReference: transactionReference || undefined,
          description: description || undefined,
        },
      });
      setCustomerId('');
      setInvoiceId('');
      setAmount('');
      setBankName('');
      setTransactionReference('');
      setDescription('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit payment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
    >
      <select
        required
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">— Select customer —</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.firstName} {c.lastName}
          </option>
        ))}
      </select>
      <select
        required
        value={invoiceId}
        onChange={(e) => setInvoiceId(e.target.value)}
        disabled={!customerId}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
      >
        <option value="">— Select invoice —</option>
        {invoices.map((inv) => (
          <option key={inv.id} value={inv.id}>
            {inv.invoiceNumber} ({formatCurrency(inv.totalAmount, inv.currency)})
          </option>
        ))}
      </select>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {MANUAL_METHODS.map((m) => (
          <option key={m} value={m}>
            {m.replace('_', ' ')}
          </option>
        ))}
      </select>
      <input
        required
        type="number"
        placeholder="Amount (₦)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Bank name"
        value={bankName}
        onChange={(e) => setBankName(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Transaction reference"
        value={transactionReference}
        onChange={(e) => setTransactionReference(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-3"
      />
      {error && <p className="col-span-2 text-sm text-red-600 sm:col-span-3">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-3"
      >
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>
    </form>
  );
}

export default function AdminManualPaymentsPage() {
  const { user } = useAuth();
  const canSubmit = !!user?.permissions.includes('manual_payment:submit');
  const canReview = !!user?.permissions.includes('manual_payment:review');
  const [showSubmitForm, setShowSubmitForm] = useState(false);

  const [submissions, setSubmissions] = useState<ManualPaymentSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!canReview) return;
    apiRequest<ManualPaymentSubmission[]>('/manual-payments/pending')
      .then(setSubmissions)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [canReview]);

  async function handleApprove(id: string) {
    const note = prompt('Optional note for this approval:') ?? undefined;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/manual-payments/${id}/approve`, { method: 'POST', body: { note } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve payment');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    const note = prompt('Reason for rejecting this submission:');
    if (note === null) return;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/manual-payments/${id}/reject`, { method: 'POST', body: { note } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject payment');
    } finally {
      setBusyId(null);
    }
  }

  async function handleClarify(id: string) {
    const note = prompt('What clarification is needed from the customer/staff?');
    if (!note) return;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/manual-payments/${id}/request-clarification`, {
        method: 'POST',
        body: { note },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request clarification');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER', 'STAFF', 'BRANCH_MANAGER']}>
      <AppShell title="Manual Payments" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {canSubmit && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Submit a Manual Payment</h2>
              <button
                onClick={() => setShowSubmitForm((v) => !v)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                {showSubmitForm ? 'Cancel' : '+ New Submission'}
              </button>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              For customers who paid by cash or bank transfer. This has no effect on the customer&apos;s
              balance until Finance approves it.
            </p>
            {showSubmitForm && (
              <SubmitManualPaymentForm
                onSubmitted={() => {
                  setShowSubmitForm(false);
                  load();
                }}
              />
            )}
          </>
        )}

        {canReview && (
          <>
            <h2 className="mt-10 text-lg font-semibold text-slate-900">Manual Payments Awaiting Review</h2>
            <p className="mt-1 text-sm text-slate-500">
              Cash and bank-transfer payments submitted by staff. Nothing here affects the customer&apos;s
              balance until you approve it.
            </p>
          </>
        )}

        <div className="mt-4 space-y-3">
          {canReview && submissions?.map((sub) => (
            <div key={sub.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-slate-900">
                    {sub.customer?.firstName} {sub.customer?.lastName} —{' '}
                    {formatCurrency(sub.amount, 'NGN')}
                  </p>
                  <p className="text-sm text-slate-500">
                    Invoice {sub.invoice?.invoiceNumber} · {sub.method.replace('_', ' ')}
                    {sub.bankName ? ` · ${sub.bankName}` : ''}
                    {sub.transactionReference ? ` · Ref: ${sub.transactionReference}` : ''}
                  </p>
                  {sub.description && <p className="mt-1 text-sm text-slate-600">{sub.description}</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    Submitted by {sub.submittedByStaff?.firstName} {sub.submittedByStaff?.lastName} ·{' '}
                    {formatDateTime(sub.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handleApprove(sub.id)}
                    disabled={busyId === sub.id}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleClarify(sub.id)}
                    disabled={busyId === sub.id}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Request clarification
                  </button>
                  <button
                    onClick={() => handleReject(sub.id)}
                    disabled={busyId === sub.id}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
          {canReview && submissions?.length === 0 && (
            <p className="text-sm text-slate-500">No manual payments are awaiting review.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
