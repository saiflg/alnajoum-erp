'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '@/lib/document-types';
import { CountryVisaRule, DocumentType } from '@/lib/types';

const VISA_TYPE_OPTIONS = ['', 'TOURIST', 'BUSINESS', 'STUDENT', 'WORK', 'TRANSIT', 'PILGRIMAGE', 'OTHER'];

const EMPTY_FORM = {
  country: '',
  visaType: '',
  requiredDocumentTypes: [] as DocumentType[],
  optionalDocumentTypes: [] as DocumentType[],
  minPassportValidityMonths: '',
  guarantorRequired: false,
  processingTimeDays: '',
  appointmentRequired: false,
  insuranceRequired: false,
  notes: '',
};

function toggleInList(list: DocumentType[], value: DocumentType): DocumentType[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Spec #4 — configurable per-country/visa-type requirements. visaType must
 * match VisaApplication.visaType's actual convention (the VisaType enum's
 * literal values, e.g. "PILGRIMAGE") — see the field's comment in
 * schema.prisma — so this form offers a fixed dropdown rather than free
 * text, with an empty selection creating the country's default rule.
 */
export default function AdminVisaCountryRulesPage() {
  const [rules, setRules] = useState<CountryVisaRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest<CountryVisaRule[]>('/visa/country-rules')
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  async function handleCreate() {
    setError(null);
    if (!form.country.trim()) {
      setError('Country is required.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/visa/country-rules', {
        method: 'POST',
        body: {
          country: form.country,
          visaType: form.visaType || undefined,
          requiredDocumentTypes: form.requiredDocumentTypes,
          optionalDocumentTypes: form.optionalDocumentTypes,
          minPassportValidityMonths: form.minPassportValidityMonths ? Number(form.minPassportValidityMonths) : undefined,
          guarantorRequired: form.guarantorRequired,
          processingTimeDays: form.processingTimeDays ? Number(form.processingTimeDays) : undefined,
          appointmentRequired: form.appointmentRequired,
          insuranceRequired: form.insuranceRequired,
          notes: form.notes || undefined,
        },
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this rule?')) return;
    try {
      await apiRequest(`/visa/country-rules/${id}/deactivate`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to deactivate rule');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Country Visa Rules" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Country Visa Rules</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure required documents, minimum passport validity, and SLA target per country/visa type. Leave visa type
          blank to set that country&apos;s default rule.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-700">New Rule</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              placeholder="Country (e.g. United Kingdom)"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={form.visaType}
              onChange={(e) => setForm({ ...form, visaType: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {VISA_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t || "Default (any visa type)"}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Min passport validity (months)"
              value={form.minPassportValidityMonths}
              onChange={(e) => setForm({ ...form, minPassportValidityMonths: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Processing time / SLA target (days)"
              value={form.processingTimeDays}
              onChange={(e) => setForm({ ...form, processingTimeDays: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500">Required documents</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {DOCUMENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={form.requiredDocumentTypes.includes(t)}
                    onChange={() => setForm({ ...form, requiredDocumentTypes: toggleInList(form.requiredDocumentTypes, t) })}
                  />
                  {DOCUMENT_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500">Optional documents</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {DOCUMENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={form.optionalDocumentTypes.includes(t)}
                    onChange={() => setForm({ ...form, optionalDocumentTypes: toggleInList(form.optionalDocumentTypes, t) })}
                  />
                  {DOCUMENT_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.guarantorRequired} onChange={(e) => setForm({ ...form, guarantorRequired: e.target.checked })} />
              Guarantor required
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.appointmentRequired} onChange={(e) => setForm({ ...form, appointmentRequired: e.target.checked })} />
              Appointment required
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.insuranceRequired} onChange={(e) => setForm({ ...form, insuranceRequired: e.target.checked })} />
              Insurance required
            </label>
          </div>

          <textarea
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={2}
          />

          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create rule'}
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {rules?.map((rule) => (
            <div key={rule.id} className={`rounded-lg border p-4 ${rule.isActive ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-slate-900">
                    {rule.country} — {rule.visaType || 'Default (any visa type)'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {rule.processingTimeDays != null && `SLA target: ${rule.processingTimeDays} days · `}
                    {rule.minPassportValidityMonths != null && `Min passport validity: ${rule.minPassportValidityMonths}mo · `}
                    {rule.guarantorRequired && 'Guarantor required · '}
                    {rule.appointmentRequired && 'Appointment required · '}
                    {rule.insuranceRequired && 'Insurance required'}
                  </p>
                  {rule.requiredDocumentTypes.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Required: {rule.requiredDocumentTypes.map((t) => DOCUMENT_TYPE_LABELS[t]).join(', ')}
                    </p>
                  )}
                  {rule.notes && <p className="mt-1 text-xs text-slate-400">{rule.notes}</p>}
                </div>
                {rule.isActive && (
                  <button onClick={() => handleDeactivate(rule.id)} className="shrink-0 text-xs font-medium text-red-600 hover:underline">
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          ))}
          {rules?.length === 0 && <p className="text-sm text-slate-500">No country visa rules configured yet.</p>}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
