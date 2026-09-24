'use client';

import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, apiUpload, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import {
  Supplier,
  SupplierBalance,
  SupplierOnboardingStatus,
} from '@/lib/types';

const CONTRACT_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  NEGOTIATION: 'bg-blue-100 text-blue-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  EXPIRING: 'bg-amber-100 text-amber-700',
  EXPIRED: 'bg-red-100 text-red-700',
  TERMINATED: 'bg-slate-100 text-slate-500',
};

/** Spec #3's forward order — the "next step" dropdown only ever offers the
 * single legal next status, same forward-only discipline the backend
 * enforces in SupplierOnboardingService. */
const NEXT_STEP: Record<string, SupplierOnboardingStatus | null> = {
  DRAFT: 'INVITED',
  INVITED: 'INFORMATION_SUBMITTED',
  INFORMATION_SUBMITTED: 'KYC_REVIEW',
  KYC_REVIEW: 'DOCUMENT_REVIEW',
  DOCUMENT_REVIEW: 'COMMERCIAL_REVIEW',
  COMMERCIAL_REVIEW: 'FINANCE_REVIEW',
  FINANCE_REVIEW: 'ADMIN_APPROVAL',
  ADMIN_APPROVAL: null, // only the approval sweep can move this forward
  ACTIVE: null,
  SUSPENDED: null,
  TERMINATED: null,
};

const EMPTY_CONTACT_FORM = { name: '', role: '', email: '', phone: '' };
const EMPTY_CONTRACT_FORM = {
  contractNumber: '',
  name: '',
  startDate: '',
  endDate: '',
  commissionPercent: '',
  markupPercent: '',
};

export default function AdminSupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [balance, setBalance] = useState<SupplierBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);
  const [contractForm, setContractForm] = useState(EMPTY_CONTRACT_FORM);
  const [documentLabel, setDocumentLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    apiRequest<Supplier>(`/suppliers/${params.id}`)
      .then(setSupplier)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load supplier'));
    apiRequest<SupplierBalance>(`/suppliers/${params.id}/balance`)
      .then(setBalance)
      .catch(() => setBalance(null));
  }

  useEffect(load, [params.id]);

  async function handleTransition(status: SupplierOnboardingStatus) {
    setError(null);
    try {
      await apiRequest(`/suppliers/${params.id}/onboarding/transition`, {
        method: 'POST',
        body: { status },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update onboarding status');
    }
  }

  async function handleAddContact(e: FormEvent) {
    e.preventDefault();
    if (!contactForm.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/suppliers/${params.id}/contacts`, {
        method: 'POST',
        body: {
          name: contactForm.name,
          role: contactForm.role || undefined,
          email: contactForm.email || undefined,
          phone: contactForm.phone || undefined,
        },
      });
      setContactForm(EMPTY_CONTACT_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add contact');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateContract(e: FormEvent) {
    e.preventDefault();
    if (!contractForm.contractNumber.trim() || !contractForm.name.trim() || !contractForm.startDate) {
      setError('Contract number, name, and start date are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/suppliers/${params.id}/contracts`, {
        method: 'POST',
        body: {
          contractNumber: contractForm.contractNumber,
          name: contractForm.name,
          startDate: contractForm.startDate,
          endDate: contractForm.endDate || undefined,
          commissionPercent: contractForm.commissionPercent
            ? Number(contractForm.commissionPercent)
            : undefined,
          markupPercent: contractForm.markupPercent
            ? Number(contractForm.markupPercent)
            : undefined,
        },
      });
      setContractForm(EMPTY_CONTRACT_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create contract');
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadDocument(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !documentLabel.trim()) {
      setError('Choose a file and a label before uploading.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiUpload(
        `/suppliers/${params.id}/documents?label=${encodeURIComponent(documentLabel)}`,
        file,
      );
      setDocumentLabel('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload document');
    } finally {
      setSaving(false);
    }
  }

  const nextStep = supplier ? NEXT_STEP[supplier.onboardingStatus] : null;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Supplier Detail" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {supplier && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{supplier.legalName}</h2>
                <p className="text-sm text-slate-500">
                  {supplier.type.replaceAll('_', ' ')} · {supplier.currency}
                  {supplier.country ? ` · ${supplier.country}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  {supplier.onboardingStatus.replaceAll('_', ' ')}
                </span>
                {nextStep && (
                  <button
                    onClick={() => handleTransition(nextStep)}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Move to {nextStep.replaceAll('_', ' ')}
                  </button>
                )}
                {supplier.onboardingStatus === 'ACTIVE' && (
                  <button
                    onClick={() => handleTransition('SUSPENDED')}
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Suspend
                  </button>
                )}
                {supplier.onboardingStatus === 'SUSPENDED' && (
                  <button
                    onClick={() => handleTransition('ACTIVE')}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </div>
            {supplier.onboardingStatus === 'ADMIN_APPROVAL' && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Awaiting a decision on the pending activation request — see{' '}
                <a href="/admin/approvals" className="underline">
                  Approvals
                </a>
                .
              </p>
            )}

            {balance && (
              <div className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Credit &amp; balance</h3>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500">Outstanding</p>
                    <p className="font-medium text-slate-800">
                      {formatCurrency(balance.currentBalance, supplier.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total paid</p>
                    <p className="font-medium text-slate-800">
                      {formatCurrency(balance.totalPaid, supplier.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Credit limit</p>
                    <p className="font-medium text-slate-800">
                      {balance.creditLimit != null
                        ? formatCurrency(balance.creditLimit, supplier.currency)
                        : 'No limit set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Utilization</p>
                    <p className="font-medium text-slate-800">
                      {balance.utilization != null
                        ? `${Math.round(balance.utilization * 100)}%`
                        : '—'}
                    </p>
                  </div>
                </div>
                {balance.alert && (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                    ⚠ {balance.alert}
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Contacts</h3>
                <ul className="mt-2 space-y-2">
                  {supplier.contacts?.map((c) => (
                    <li key={c.id} className="text-sm text-slate-700">
                      <span className="font-medium">{c.name}</span>
                      {c.role && <span className="text-slate-500"> — {c.role}</span>}
                      {c.isPrimary && (
                        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          primary
                        </span>
                      )}
                      <p className="text-xs text-slate-400">
                        {[c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </li>
                  ))}
                  {supplier.contacts?.length === 0 && (
                    <li className="text-sm text-slate-400">No contacts on file.</li>
                  )}
                </ul>
                <form onSubmit={handleAddContact} className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                  <input
                    placeholder="Name"
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Role"
                    value={contactForm.role}
                    onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="col-span-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Add contact
                  </button>
                </form>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Documents</h3>
                <ul className="mt-2 space-y-1">
                  {supplier.documents?.map((d) => (
                    <li key={d.id} className="text-sm text-slate-700">
                      <a
                        href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/supplier-documents/${d.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-700 underline hover:text-slate-900"
                      >
                        {d.label}
                      </a>
                      {d.expiresAt && (
                        <span className="ml-1 text-xs text-slate-400">
                          expires {formatDateTime(d.expiresAt)}
                        </span>
                      )}
                    </li>
                  ))}
                  {supplier.documents?.length === 0 && (
                    <li className="text-sm text-slate-400">No documents uploaded.</li>
                  )}
                </ul>
                <form onSubmit={handleUploadDocument} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  <input
                    placeholder="Document label (e.g. Certificate of Incorporation)"
                    value={documentLabel}
                    onChange={(e) => setDocumentLabel(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input ref={fileInputRef} type="file" className="w-full text-sm" />
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Upload
                  </button>
                </form>
              </div>
            </div>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Contracts</h3>
            <div className="mt-2 max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Contract #</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Start</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">End</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplier.contracts?.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium text-slate-800">{c.contractNumber}</td>
                      <td className="px-3 py-2 text-slate-600">{c.name}</td>
                      <td className="px-3 py-2 text-slate-600">{formatDateTime(c.startDate)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.endDate ? formatDateTime(c.endDate) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONTRACT_STATUS_STYLES[c.status] ?? 'bg-slate-100 text-slate-600'}`}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {supplier.contracts?.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-center text-slate-500" colSpan={5}>
                        No contracts on file for this supplier.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <form
                onSubmit={handleCreateContract}
                className="border-t border-slate-100 p-4"
              >
                <h4 className="text-sm font-semibold text-slate-900">New contract</h4>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <input
                    placeholder="Contract number"
                    value={contractForm.contractNumber}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, contractNumber: e.target.value })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Contract name"
                    value={contractForm.name}
                    onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="date"
                    value={contractForm.startDate}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, startDate: e.target.value })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="date"
                    value={contractForm.endDate}
                    onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="End date (optional)"
                  />
                  <input
                    placeholder="Commission %"
                    type="number"
                    value={contractForm.commissionPercent}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, commissionPercent: e.target.value })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Markup %"
                    type="number"
                    value={contractForm.markupPercent}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, markupPercent: e.target.value })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Add contract'}
                </button>
              </form>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
