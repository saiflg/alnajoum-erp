'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { FamilyMember, VisaApplication, VisaType } from '@/lib/types';

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
  IN_REVIEW: 'bg-amber-100 text-amber-700',
  ADDITIONAL_DOCUMENTS_REQUIRED: 'bg-orange-100 text-orange-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  ISSUED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const TERMINAL = ['ISSUED', 'REJECTED', 'CANCELLED'];

export default function PortalVisaPage() {
  const [applications, setApplications] = useState<VisaApplication[] | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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
  }

  useEffect(load, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/visa/applications/me', {
        method: 'POST',
        body: {
          destinationCountry,
          visaType,
          intendedTravelDate: intendedTravelDate || undefined,
          familyMemberId: applicant || undefined,
          notes: notes || undefined,
        },
      });
      setNotice('Visa application submitted — you can track its status below.');
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
          Submit your destination and travel details — we handle document collection and
          embassy processing, and keep you updated as the status changes. Upload your
          passport and photo under My Profile or Family Members before applying.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-4 text-sm text-emerald-600">{notice}</p>}

        <form
          onSubmit={handleSubmit}
          className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
        >
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
              <div className="mt-2 flex items-center gap-4">
                {app.invoice && (
                  <Link
                    href={`/portal/invoices/${app.invoice.id}`}
                    className="text-sm font-medium text-slate-700 hover:underline"
                  >
                    View invoice
                  </Link>
                )}
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
