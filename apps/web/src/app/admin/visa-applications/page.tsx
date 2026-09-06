'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, apiUpload, ApiError } from '@/lib/api';
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '@/lib/document-types';
import { formatCurrency, formatDateTime } from '@/lib/format';
import {
  DocumentType,
  Guarantor,
  VisaApplication,
  VisaApplicationNote,
  VisaApplicationStatus,
  VisaChecklist,
  VisaDocument,
  VisaProviderMessage,
  VisaRefund,
  VisaRefundPreview,
  VisaSubmission,
  VisaTimelineEvent,
  PassportValidity,
} from '@/lib/types';

const PASSPORT_BADGE_STYLES: Record<string, string> = {
  GREEN: 'bg-emerald-100 text-emerald-700',
  AMBER: 'bg-amber-100 text-amber-700',
  RED: 'bg-red-100 text-red-700',
  UNKNOWN: 'bg-slate-100 text-slate-500',
};

const CHECKLIST_ITEM_STYLES: Record<string, string> = {
  MISSING: 'bg-red-100 text-red-700',
  UPLOADED: 'bg-amber-100 text-amber-700',
  VERIFIED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-slate-200 text-slate-600',
  EXEMPTED: 'bg-blue-100 text-blue-700',
};

const MESSAGE_SEVERITY_STYLES: Record<string, string> = {
  INFO: 'border-slate-200 bg-white',
  WARNING: 'border-amber-200 bg-amber-50',
  ACTION_REQUIRED: 'border-red-200 bg-red-50',
};

const STATUSES: Array<VisaApplicationStatus | ''> = [
  '',
  'SUBMITTED',
  'AWAITING_GUARANTOR',
  'GUARANTOR_VERIFICATION',
  'PAYMENT_PENDING',
  'PAYMENT_VERIFIED',
  'UNDER_REVIEW',
  'SUBMITTED_TO_PROVIDER',
  'PROCESSING',
  'ADDITIONAL_INFO_REQUIRED',
  'ADDITIONAL_DOCUMENTS_REQUIRED',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
];

const NEXT_STATUSES: VisaApplicationStatus[] = [
  'SUBMITTED',
  'AWAITING_DOCUMENTS',
  'UNDER_REVIEW',
  'SUBMITTED_TO_PROVIDER',
  'PROCESSING',
  'ADDITIONAL_INFO_REQUIRED',
  'ADDITIONAL_DOCUMENTS_REQUIRED',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'COMPLETED',
  'CANCELLED',
];

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-700',
  AWAITING_GUARANTOR: 'bg-orange-100 text-orange-700',
  GUARANTOR_VERIFICATION: 'bg-orange-100 text-orange-700',
  PAYMENT_PENDING: 'bg-amber-100 text-amber-700',
  PAYMENT_VERIFIED: 'bg-amber-100 text-amber-700',
  UNDER_REVIEW: 'bg-amber-100 text-amber-700',
  SUBMITTED_TO_PROVIDER: 'bg-purple-100 text-purple-700',
  PROCESSING: 'bg-purple-100 text-purple-700',
  ADDITIONAL_INFO_REQUIRED: 'bg-orange-100 text-orange-700',
  ADDITIONAL_DOCUMENTS_REQUIRED: 'bg-orange-100 text-orange-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  ISSUED: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  EXPIRED: 'bg-slate-200 text-slate-600',
};

const TERMINAL: VisaApplicationStatus[] = ['ISSUED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED'];

const DOC_STATUS_STYLES: Record<string, string> = {
  PENDING_REVIEW: 'bg-amber-100 text-amber-700',
  VERIFIED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-slate-200 text-slate-600',
};

function ApplicationDetail({ app, onChanged }: { app: VisaApplication; onChanged: () => void }) {
  const [guarantor, setGuarantor] = useState<Guarantor | null>(null);
  const [documents, setDocuments] = useState<VisaDocument[]>([]);
  const [notes, setNotes] = useState<VisaApplicationNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [docType, setDocType] = useState<DocumentType>('PASSPORT');
  const [uploading, setUploading] = useState(false);
  const [verificationNote, setVerificationNote] = useState('');

  // Phase 9
  const [checklist, setChecklist] = useState<VisaChecklist | null>(null);
  const [passportValidity, setPassportValidity] = useState<PassportValidity | null>(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionType, setExceptionType] = useState<DocumentType>('PASSPORT');
  const [submissions, setSubmissions] = useState<VisaSubmission[]>([]);
  const [messages, setMessages] = useState<VisaProviderMessage[]>([]);
  const [manualMessage, setManualMessage] = useState('');
  const [refunds, setRefunds] = useState<VisaRefund[]>([]);
  const [refundPreview, setRefundPreview] = useState<VisaRefundPreview | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [timeline, setTimeline] = useState<VisaTimelineEvent[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (app.guarantorId) {
      apiRequest<Guarantor>(`/visa/guarantors/${app.guarantorId}`).then(setGuarantor).catch(() => undefined);
    }
    apiRequest<VisaDocument[]>(`/visa/documents/application/${app.id}`).then(setDocuments).catch(() => undefined);
    apiRequest<VisaApplicationNote[]>(`/visa/applications/${app.id}/notes`).then(setNotes).catch(() => undefined);
    apiRequest<VisaChecklist>(`/visa/applications/${app.id}/checklist`).then(setChecklist).catch(() => undefined);
    apiRequest<PassportValidity>(`/visa/applications/${app.id}/checklist/passport-validity`).then(setPassportValidity).catch(() => undefined);
    apiRequest<VisaSubmission[]>(`/visa/applications/${app.id}/submission`).then(setSubmissions).catch(() => undefined);
    apiRequest<VisaProviderMessage[]>(`/visa/applications/${app.id}/submission/messages`).then(setMessages).catch(() => undefined);
    apiRequest<VisaRefund[]>(`/visa/applications/${app.id}/refunds`).then(setRefunds).catch(() => undefined);
    apiRequest<VisaRefundPreview>(`/visa/applications/${app.id}/refund-preview`).then(setRefundPreview).catch(() => undefined);
    apiRequest<VisaTimelineEvent[]>(`/visa/applications/${app.id}/timeline`).then(setTimeline).catch(() => undefined);
  }

  useEffect(load, [app.id, app.guarantorId]);

  async function handleAddException(e: FormEvent) {
    e.preventDefault();
    if (!exceptionReason.trim()) return;
    setError(null);
    try {
      await apiRequest(`/visa/applications/${app.id}/checklist/exceptions`, {
        method: 'POST',
        body: { documentType: exceptionType, reason: exceptionReason },
      });
      setExceptionReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add exception');
    }
  }

  async function handleSubmitToProvider() {
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/visa/applications/${app.id}/submission`, { method: 'POST' });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit to provider');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncStatus() {
    setError(null);
    try {
      await apiRequest(`/visa/applications/${app.id}/submission/sync`, { method: 'POST' });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sync provider status');
    }
  }

  async function handleAddManualMessage(e: FormEvent) {
    e.preventDefault();
    if (!manualMessage.trim()) return;
    setError(null);
    try {
      await apiRequest(`/visa/applications/${app.id}/submission/messages`, {
        method: 'POST',
        body: { message: manualMessage },
      });
      setManualMessage('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to log message');
    }
  }

  async function handleAcknowledgeMessage(id: string) {
    try {
      await apiRequest(`/visa/applications/${app.id}/submission/messages/${id}/acknowledge`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to acknowledge message');
    }
  }

  async function handleRequestRefund() {
    if (!confirm(`Refund ${formatCurrency(refundPreview?.refundAmount ?? 0, refundPreview?.currency ?? app.currency)}?`)) return;
    setError(null);
    try {
      await apiRequest(`/visa/applications/${app.id}/refund`, {
        method: 'POST',
        body: { reason: refundReason || undefined },
      });
      setRefundReason('');
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process refund');
    }
  }

  async function handleGuarantorDecision(approved: boolean) {
    setError(null);
    try {
      await apiRequest(`/visa/guarantors/${app.guarantorId}/verify`, {
        method: 'POST',
        body: {
          verificationStatus: approved ? 'VERIFIED' : 'REJECTED',
          approvalStatus: approved ? 'APPROVED' : 'REJECTED',
          verificationNote: verificationNote || undefined,
        },
      });
      setVerificationNote('');
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to verify guarantor');
    }
  }

  async function handleDocumentReview(id: string, status: 'VERIFIED' | 'REJECTED') {
    try {
      await apiRequest(`/visa/documents/${id}/review`, { method: 'POST', body: { status } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to review document');
    }
  }

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('file') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await apiUpload(`/visa/documents/for-application/${app.id}?type=${docType}`, file);
      input.value = '';
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await apiRequest(`/visa/applications/${app.id}/notes`, { method: 'POST', body: { note } });
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add note');
    }
  }

  async function handleVerifyPayment() {
    setError(null);
    try {
      await apiRequest(`/visa/applications/${app.id}/verify-payment`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to verify payment');
    }
  }

  const slaOverdue = app.slaDueAt && new Date(app.slaDueAt) < new Date() && !TERMINAL.includes(app.status);

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-5">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {passportValidity && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PASSPORT_BADGE_STYLES[passportValidity.level]}`}>
            Passport: {passportValidity.level}
            {passportValidity.monthsUntilExpiry != null && ` (${passportValidity.monthsUntilExpiry}mo left)`}
          </span>
        )}
        {app.slaDueAt && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${slaOverdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
            SLA due {formatDateTime(app.slaDueAt)}{slaOverdue ? ' — OVERDUE' : ''}
          </span>
        )}
        {app.expiryDate && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Visa expiry: {formatDateTime(app.expiryDate)}
          </span>
        )}
      </div>

      {app.status === 'PAYMENT_PENDING' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            Invoice status: <strong>{app.invoice?.status ?? 'ISSUED'}</strong>
            {app.invoice?.status === 'PAID'
              ? ' — fully paid, ready to verify.'
              : ' — not yet fully paid.'}
          </p>
          <button
            onClick={handleVerifyPayment}
            disabled={app.invoice?.status !== 'PAID'}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Verify payment
          </button>
        </div>
      )}

      {app.guarantorId && (
        <div>
          <p className="text-sm font-semibold text-slate-700">Guarantor</p>
          {guarantor ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-800">{guarantor.fullName} ({guarantor.relationship})</p>
              <p className="text-slate-600">{guarantor.phone}{guarantor.email ? ` · ${guarantor.email}` : ''}</p>
              <p className="mt-1 text-xs text-slate-500">
                Verification: {guarantor.verificationStatus} · Approval: {guarantor.approvalStatus}
              </p>
              {guarantor.approvalStatus === 'PENDING' && (
                <div className="mt-2 space-y-2">
                  <input
                    placeholder="Verification note (optional)"
                    value={verificationNote}
                    onChange={(e) => setVerificationNote(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => handleGuarantorDecision(true)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
                      Approve guarantor
                    </button>
                    <button onClick={() => handleGuarantorDecision(false)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                      Reject guarantor
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Loading…</p>
          )}
        </div>
      )}

      {checklist && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Document Checklist</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${checklist.mandatoryComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {checklist.mandatoryComplete ? 'Mandatory-complete' : 'Incomplete'}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {checklist.items.map((item) => (
              <div key={item.documentType} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-2 text-sm">
                <span className="text-slate-700">
                  {DOCUMENT_TYPE_LABELS[item.documentType]}
                  {item.required && <span className="ml-1 text-[10px] uppercase text-slate-400">required</span>}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHECKLIST_ITEM_STYLES[item.state]}`} title={item.exceptionReason ?? undefined}>
                  {item.state}
                </span>
              </div>
            ))}
            {checklist.items.length === 0 && (
              <p className="text-xs text-slate-500">No document rule configured for this country/visa type yet — nothing blocks submission.</p>
            )}
          </div>
          <form onSubmit={handleAddException} className="mt-2 flex flex-wrap items-center gap-2">
            <select value={exceptionType} onChange={(e) => setExceptionType(e.target.value as DocumentType)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs">
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <input
              placeholder="Reason for exempting this document…"
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
              className="flex-1 min-w-[200px] rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            />
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
              Grant exception
            </button>
          </form>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-slate-700">Documents</p>
        <div className="mt-2 space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-2 text-sm">
              <div>
                <span className="font-medium text-slate-800">{DOCUMENT_TYPE_LABELS[doc.type]}</span>
                <span className="ml-2 text-xs text-slate-500">{doc.originalFileName}</span>
                {doc.expiryDate && <span className="ml-2 text-xs text-slate-400">expires {formatDateTime(doc.expiryDate)}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DOC_STATUS_STYLES[doc.status] ?? 'bg-slate-100'}`}>
                  {doc.status.replace(/_/g, ' ')}
                </span>
                {doc.status === 'PENDING_REVIEW' && (
                  <>
                    <button onClick={() => handleDocumentReview(doc.id, 'VERIFIED')} className="text-xs font-medium text-emerald-700 hover:underline">Verify</button>
                    <button onClick={() => handleDocumentReview(doc.id, 'REJECTED')} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {documents.length === 0 && <p className="text-xs text-slate-500">No documents uploaded yet.</p>}
        </div>
        <form onSubmit={handleUpload} className="mt-2 flex flex-wrap items-center gap-2">
          <select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs">
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <input type="file" name="file" required className="text-xs" />
          <button type="submit" disabled={uploading} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Provider Submission</p>
          {app.status === 'UNDER_REVIEW' && (
            <button
              onClick={handleSubmitToProvider}
              disabled={submitting}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit to provider'}
            </button>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {submissions.map((sub) => (
            <div key={sub.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800">
                  {sub.provider} {sub.externalReference && `· ${sub.externalReference}`}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{sub.providerStatus}</span>
              </div>
              {sub.provider === 'MOCK' && sub.externalReference && (
                <button onClick={handleSyncStatus} className="mt-1 text-[11px] font-medium text-blue-700 hover:underline">
                  Sync status from provider
                </button>
              )}
            </div>
          ))}
          {submissions.length === 0 && (
            <p className="text-xs text-slate-500">
              Not yet submitted to a provider{app.status !== 'UNDER_REVIEW' ? ' — must be under review first' : ''}.
            </p>
          )}
        </div>

        <p className="mt-3 text-xs font-semibold text-slate-600">Provider Messages</p>
        <div className="mt-1 space-y-1">
          {messages.map((m) => (
            <div key={m.id} className={`rounded-md border p-2 text-xs ${MESSAGE_SEVERITY_STYLES[m.severity]}`}>
              <p className="text-slate-700">{m.message}</p>
              <div className="mt-1 flex items-center justify-between text-slate-400">
                <span>{m.severity} · {formatDateTime(m.createdAt)}</span>
                {!m.acknowledgedAt && (
                  <button onClick={() => handleAcknowledgeMessage(m.id)} className="font-medium text-blue-700 hover:underline">
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          ))}
          {messages.length === 0 && <p className="text-xs text-slate-500">No provider messages yet.</p>}
        </div>
        <form onSubmit={handleAddManualMessage} className="mt-2 flex gap-2">
          <input
            placeholder="Log a manual update (e.g. phone call with the embassy)…"
            value={manualMessage}
            onChange={(e) => setManualMessage(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          />
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            Log
          </button>
        </form>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700">Refund</p>
        {refunds.length > 0 ? (
          <div className="mt-2 space-y-1">
            {refunds.map((r) => (
              <div key={r.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                <p className="text-slate-700">
                  {formatCurrency(r.refundAmount, r.currency)} refunded — {r.status}
                </p>
                <p className="mt-1 text-slate-400">
                  Paid {formatCurrency(r.amountPaid, r.currency)}, penalty {formatCurrency(r.supplierPenalty, r.currency)}, fee{' '}
                  {formatCurrency(r.agencyFee, r.currency)}
                  {r.reason && ` · ${r.reason}`}
                </p>
              </div>
            ))}
          </div>
        ) : refundPreview ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-white p-3 text-xs">
            <p className="text-slate-700">
              Refund preview: {formatCurrency(refundPreview.refundAmount, refundPreview.currency)}{' '}
              <span className="text-slate-400">
                (paid {formatCurrency(refundPreview.amountPaid, refundPreview.currency)} − penalty{' '}
                {formatCurrency(refundPreview.supplierPenalty, refundPreview.currency)} − fee{' '}
                {formatCurrency(refundPreview.agencyFee, refundPreview.currency)})
              </span>
            </p>
            {refundPreview.alreadySubmittedToProvider && (
              <p className="mt-1 text-amber-700">Already submitted to the provider — the embassy/agent cost is forfeited.</p>
            )}
            <div className="mt-2 flex gap-2">
              <input
                placeholder="Reason (optional)"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              />
              <button onClick={handleRequestRefund} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                Process refund
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-500">No payment to refund yet.</p>
        )}
      </div>

      {timeline && timeline.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-slate-700">Timeline</p>
          <div className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
            {timeline.map((event, i) => (
              <div key={i} className="text-xs">
                <p className="text-slate-700">
                  {event.detail ?? event.action.replace(/_/g, ' ').replace(/\./g, ' → ')}
                </p>
                <p className="text-slate-400">
                  {formatDateTime(event.timestamp)}
                  {event.actorEmail && ` · ${event.actorEmail}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-slate-700">Internal notes (staff only)</p>
        <div className="mt-2 space-y-1">
          {notes.map((n) => (
            <div key={n.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
              <p className="text-slate-700">{n.note}</p>
              <p className="mt-1 text-slate-400">
                {n.staff ? `${n.staff.firstName} ${n.staff.lastName}` : 'Staff'} · {formatDateTime(n.createdAt)}
              </p>
            </div>
          ))}
          {notes.length === 0 && <p className="text-xs text-slate-500">No notes yet.</p>}
        </div>
        <form onSubmit={handleAddNote} className="mt-2 flex gap-2">
          <input
            placeholder="Add an internal note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
            Add
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminVisaApplicationsPageInner() {
  const searchParams = useSearchParams();
  const [applications, setApplications] = useState<VisaApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VisaApplicationStatus | ''>(
    (searchParams.get('status') as VisaApplicationStatus | null) ?? '',
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<VisaApplication[]>(`/visa/applications?${params.toString()}`)
      .then(setApplications)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [statusFilter]);

  async function handleStatusChange(id: string, status: VisaApplicationStatus) {
    if (!status) return;
    const staffNote =
      prompt(
        status === 'REJECTED'
          ? 'Reason for rejecting this application:'
          : 'Optional note for the applicant:',
      ) ?? undefined;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/visa/applications/${id}/status`, {
        method: 'POST',
        body: { status, staffNote: staffNote || undefined },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'FINANCE_OFFICER']}>
      <AppShell title="Visa Applications" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Visa Applications</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as VisaApplicationStatus | '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          {applications?.map((app) => (
            <div key={app.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button className="text-left" onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}>
                    <p className="font-medium text-slate-900">
                      {app.customer ? `${app.customer.firstName} ${app.customer.lastName}` : '—'} —{' '}
                      {app.destinationCountry} ({app.visaType.replace(/_/g, ' ')})
                      <span className="ml-2 text-xs text-slate-500">{app.applicationReference}</span>
                      {app.isOfflineEntry && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Offline</span>}
                    </p>
                    <p className="text-sm text-slate-500">
                      {app.applicantFirstName} {app.applicantLastName} ·{' '}
                      {formatCurrency(app.totalAmount, app.currency)} · {formatDateTime(app.createdAt)}
                      {app.assignedStaff && ` · Assigned: ${app.assignedStaff.firstName} ${app.assignedStaff.lastName}`}
                    </p>
                    {app.staffNote && <p className="mt-1 text-xs text-slate-500">Note: {app.staffNote}</p>}
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[app.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {app.status.replace(/_/g, ' ')}
                    </span>
                    {!TERMINAL.includes(app.status) && (
                      <select
                        value=""
                        disabled={busyId === app.id}
                        onChange={(e) => handleStatusChange(app.id, e.target.value as VisaApplicationStatus)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <option value="">Change status…</option>
                        {NEXT_STATUSES.filter((s) => s !== app.status).map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => setExpandedId(expandedId === app.id ? null : app.id)} className="text-xs text-slate-400 hover:text-slate-700">
                      {expandedId === app.id ? 'Hide' : 'Details'}
                    </button>
                  </div>
                </div>
              </div>
              {expandedId === app.id && <ApplicationDetail app={app} onChanged={load} />}
            </div>
          ))}
          {applications?.length === 0 && (
            <p className="text-sm text-slate-500">No visa applications found.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

export default function AdminVisaApplicationsPage() {
  return (
    <Suspense fallback={null}>
      <AdminVisaApplicationsPageInner />
    </Suspense>
  );
}
