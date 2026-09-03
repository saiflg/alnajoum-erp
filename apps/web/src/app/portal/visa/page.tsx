'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, apiUpload, ApiError } from '@/lib/api';
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '@/lib/document-types';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import {
  DocumentType,
  FamilyMember,
  PublicVisaService,
  VisaApplication,
  VisaDocument,
  VisaType,
} from '@/lib/types';

const VISA_TYPES: { value: VisaType; label: string }[] = [
  { value: 'TOURIST', label: 'Tourist' },
  { value: 'BUSINESS', label: 'Business' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'WORK', label: 'Work' },
  { value: 'TRANSIT', label: 'Transit' },
  { value: 'PILGRIMAGE', label: 'Pilgrimage (Hajj/Umrah)' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-700',
  AWAITING_GUARANTOR: 'bg-orange-100 text-orange-700',
  GUARANTOR_VERIFICATION: 'bg-orange-100 text-orange-700',
  PAYMENT_PENDING: 'bg-amber-100 text-amber-700',
  PAYMENT_VERIFIED: 'bg-amber-100 text-amber-700',
  UNDER_REVIEW: 'bg-amber-100 text-amber-700',
  IN_REVIEW: 'bg-amber-100 text-amber-700',
  SUBMITTED_TO_PROVIDER: 'bg-purple-100 text-purple-700',
  PROCESSING: 'bg-purple-100 text-purple-700',
  ADDITIONAL_INFO_REQUIRED: 'bg-orange-100 text-orange-700',
  ADDITIONAL_DOCUMENTS_REQUIRED: 'bg-orange-100 text-orange-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  ISSUED: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const TERMINAL = ['ISSUED', 'REJECTED', 'CANCELLED', 'COMPLETED'];

function GuarantorForm({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/visa/applications/me/${applicationId}/guarantor`, {
        method: 'POST',
        body: { fullName, phone, email: email || undefined, relationship },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit guarantor');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-orange-200 bg-orange-50 p-3">
      <p className="col-span-2 text-xs font-medium text-orange-800">
        This application requires a guarantor before it can proceed.
      </p>
      <input required placeholder="Guarantor full name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
      <input required placeholder="Relationship (e.g. Spouse)" value={relationship} onChange={(e) => setRelationship(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
      <input required placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
      <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
      {error && <p className="col-span-2 text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="col-span-2 w-fit rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {submitting ? 'Submitting…' : 'Submit guarantor'}
      </button>
    </form>
  );
}

function DocumentsPanel({ applicationId }: { applicationId: string }) {
  const [documents, setDocuments] = useState<VisaDocument[]>([]);
  const [docType, setDocType] = useState<DocumentType>('PASSPORT');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiRequest<VisaDocument[]>(`/visa/applications/me/${applicationId}/documents`).then(setDocuments).catch(() => undefined);
  }

  useEffect(load, [applicationId]);

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('file') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await apiUpload(`/visa/applications/me/${applicationId}/documents?type=${docType}`, file);
      input.value = '';
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-xs font-semibold text-slate-700">Documents</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {documents.map((d) => (
          <span key={d.id} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
            {DOCUMENT_TYPE_LABELS[d.type]} — {d.status.replace(/_/g, ' ')}
          </span>
        ))}
        {documents.length === 0 && <span className="text-xs text-slate-400">None uploaded yet.</span>}
      </div>
      <form onSubmit={handleUpload} className="mt-2 flex flex-wrap items-center gap-2">
        <select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <input type="file" name="file" required className="text-xs" />
        <button type="submit" disabled={uploading} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function PortalVisaPage() {
  const [applications, setApplications] = useState<VisaApplication[] | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [catalog, setCatalog] = useState<PublicVisaService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [visaServiceId, setVisaServiceId] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [visaType, setVisaType] = useState<VisaType>('TOURIST');
  const [intendedTravelDate, setIntendedTravelDate] = useState('');
  const [applicant, setApplicant] = useState(''); // '' = self, else familyMemberId
  const [notes, setNotes] = useState('');

  function load() {
    apiRequest<VisaApplication[]>('/visa/applications/me')
      .then(setApplications)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    apiRequest<FamilyMember[]>('/customers/me/family-members')
      .then(setFamilyMembers)
      .catch(() => undefined);
    apiRequest<PublicVisaService[]>('/visa/services/public')
      .then(setCatalog)
      .catch(() => undefined);
  }

  useEffect(load, []);

  const selectedService = catalog.find((s) => s.id === visaServiceId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/visa/applications/me', {
        method: 'POST',
        body: {
          destinationCountry: selectedService?.country ?? destinationCountry,
          visaType,
          visaServiceId: visaServiceId || undefined,
          intendedTravelDate: intendedTravelDate || undefined,
          familyMemberId: applicant || undefined,
          notes: notes || undefined,
        },
      });
      setNotice('Visa application submitted — you can track its status below.');
      setVisaServiceId('');
      setDestinationCountry('');
      setIntendedTravelDate('');
      setApplicant('');
      setNotes('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await apiRequest(`/visa/applications/me/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Visa Applications" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Apply for a Visa</h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose one of our pre-configured visa packages below, or fill in your destination
          directly. We handle document collection and embassy processing, and keep you
          updated as the status changes.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-4 text-sm text-emerald-600">{notice}</p>}

        <form
          onSubmit={handleSubmit}
          className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
        >
          {catalog.length > 0 && (
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">Visa package (optional)</label>
              <select
                value={visaServiceId}
                onChange={(e) => setVisaServiceId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Fill in details manually instead —</option>
                {catalog.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.country} — {s.visaType} ({formatCurrency(s.price, s.currency)})
                  </option>
                ))}
              </select>
              {selectedService && (
                <p className="mt-1 text-xs text-slate-500">
                  {selectedService.description}
                  {selectedService.processingTime && ` · Processing: ${selectedService.processingTime}`}
                </p>
              )}
            </div>
          )}
          {!selectedService && (
            <div>
              <label className="text-sm font-medium text-slate-700">Destination country</label>
              <input
                value={destinationCountry}
                onChange={(e) => setDestinationCountry(e.target.value)}
                required
                minLength={2}
                placeholder="Saudi Arabia"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-700">Visa type</label>
            <select
              value={visaType}
              onChange={(e) => setVisaType(e.target.value as VisaType)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {VISA_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Intended travel date</label>
            <input
              type="date"
              value={intendedTravelDate}
              onChange={(e) => setIntendedTravelDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Applicant</label>
            <select
              value={applicant}
              onChange={(e) => setApplicant(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Myself</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} ({m.relationship})
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="sm:col-span-2 mt-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </form>

        <h2 className="mt-10 text-lg font-semibold text-slate-900">My Visa Applications</h2>
        <div className="mt-4 space-y-3">
          {applications?.map((app) => (
            <div key={app.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    {app.destinationCountry} — {app.visaType.replace(/_/g, ' ')}{' '}
                    <span className="ml-2 text-xs text-slate-500">{app.applicationReference}</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    {app.applicantFirstName} {app.applicantLastName}
                    {app.intendedTravelDate && ` · travel ${formatDateTime(app.intendedTravelDate)}`} ·{' '}
                    {formatCurrency(app.totalAmount, app.currency)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[app.status] ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {app.status.replace(/_/g, ' ')}
                </span>
              </div>
              {app.staffNote && (
                <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                  Note from our visa team: {app.staffNote}
                </p>
              )}
              {app.status === 'AWAITING_GUARANTOR' && (
                <GuarantorForm applicationId={app.id} onDone={load} />
              )}
              <div className="mt-2 flex items-center gap-4">
                {app.invoice && (
                  <Link
                    href={`/portal/invoices/${app.invoice.id}`}
                    className="text-sm font-medium text-slate-700 hover:underline"
                  >
                    View invoice
                  </Link>
                )}
                <button
                  onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                  className="text-sm font-medium text-slate-500 hover:underline"
                >
                  {expandedId === app.id ? 'Hide documents' : 'Documents'}
                </button>
                {!TERMINAL.includes(app.status) && (
                  <button
                    onClick={() => handleCancel(app.id)}
                    disabled={cancellingId === app.id}
                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    {cancellingId === app.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </div>
              {expandedId === app.id && <DocumentsPanel applicationId={app.id} />}
            </div>
          ))}
          {applications?.length === 0 && (
            <p className="text-sm text-slate-500">You have not submitted a visa application yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
