'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { IncentivePolicy, IncentivePolicyType, VisaService, VisaServiceStatus } from '@/lib/types';

const STATUSES: VisaServiceStatus[] = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED'];

const POLICY_TYPES: { value: IncentivePolicyType; label: string; configHint: string }[] = [
  { value: 'FULL_MARGIN', label: '100% of margin', configHint: 'No extra input needed' },
  { value: 'PERCENT_OF_MARGIN', label: 'Percentage of margin', configHint: 'e.g. 50 for 50%' },
  { value: 'FIXED_AMOUNT', label: 'Fixed amount', configHint: 'e.g. 50000 (₦)' },
  { value: 'STAFF_COMPANY_SPLIT', label: 'Staff / Company split', configHint: 'Staff % (e.g. 70)' },
  { value: 'STAFF_BRANCH_COMPANY_SPLIT', label: 'Staff / Branch / Company split', configHint: 'Staff % (e.g. 60)' },
  { value: 'CUSTOM', label: 'Custom', configHint: 'Percent or fixed amount' },
];

function PolicyForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<IncentivePolicyType>('FULL_MARGIN');
  const [value, setValue] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function configFor(type: IncentivePolicyType, value: string): Record<string, number> {
    const num = Number(value || 0);
    switch (type) {
      case 'FULL_MARGIN':
        return {};
      case 'FIXED_AMOUNT':
        return { amount: num };
      case 'STAFF_COMPANY_SPLIT':
      case 'STAFF_BRANCH_COMPANY_SPLIT':
        return { staffPercent: num };
      default:
        return { percent: num };
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/visa/incentive-policies', {
        method: 'POST',
        body: { name, type, config: configFor(type, value), isDefault },
      });
      setName('');
      setValue('');
      setIsDefault(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create policy');
    } finally {
      setSubmitting(false);
    }
  }

  const hint = POLICY_TYPES.find((p) => p.value === type)?.configHint ?? '';

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <input required placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <select value={type} onChange={(e) => setType(e.target.value as IncentivePolicyType)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
        {POLICY_TYPES.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {type !== 'FULL_MARGIN' && (
        <input placeholder={hint} value={value} onChange={(e) => setValue(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      )}
      <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Platform default
      </label>
      <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {submitting ? 'Saving…' : '+ Add policy'}
      </button>
      {error && <p className="col-span-2 text-sm text-red-600 sm:col-span-5">{error}</p>}
    </form>
  );
}

interface FormState {
  country: string;
  visaType: string;
  visaCategory: string;
  description: string;
  processingTime: string;
  validityPeriod: string;
  entryType: string;
  requiredDocuments: string;
  supplierName: string;
  supplierCost: string;
  companyCost: string;
  sellingPrice: string;
  processingFee: string;
  otherFees: string;
  requiresGuarantor: boolean;
  incentivePolicyId: string;
}

const EMPTY_FORM: FormState = {
  country: '',
  visaType: '',
  visaCategory: '',
  description: '',
  processingTime: '',
  validityPeriod: '',
  entryType: '',
  requiredDocuments: '',
  supplierName: '',
  supplierCost: '',
  companyCost: '',
  sellingPrice: '',
  processingFee: '0',
  otherFees: '0',
  requiresGuarantor: true,
  incentivePolicyId: '',
};

function toPayload(form: FormState) {
  return {
    country: form.country,
    visaType: form.visaType,
    visaCategory: form.visaCategory || undefined,
    description: form.description || undefined,
    processingTime: form.processingTime || undefined,
    validityPeriod: form.validityPeriod || undefined,
    entryType: form.entryType || undefined,
    requiredDocuments: form.requiredDocuments || undefined,
    supplierName: form.supplierName || undefined,
    supplierCost: form.supplierCost ? Number(form.supplierCost) : undefined,
    companyCost: Number(form.companyCost),
    sellingPrice: Number(form.sellingPrice),
    processingFee: Number(form.processingFee || 0),
    otherFees: Number(form.otherFees || 0),
    requiresGuarantor: form.requiresGuarantor,
    incentivePolicyId: form.incentivePolicyId || undefined,
  };
}

export default function AdminVisaServicesPage() {
  const [services, setServices] = useState<VisaService[] | null>(null);
  const [policies, setPolicies] = useState<IncentivePolicy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  function load() {
    apiRequest<VisaService[]>('/visa/services')
      .then(setServices)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    apiRequest<IncentivePolicy[]>('/visa/incentive-policies')
      .then(setPolicies)
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiRequest('/visa/services', { method: 'POST', body: toPayload(form) });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create visa service');
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    try {
      await apiRequest(`/visa/services/${id}`, { method: 'PATCH', body: patch });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Visa Services" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Incentive Policies</h2>
          <p className="mt-1 text-xs text-slate-500">
            The Super Administrator configures how much of a visa&apos;s margin becomes staff
            incentive — nothing is assumed automatically. Attach a policy to a visa service
            below, or mark one &quot;platform default&quot; to apply when a service has none set.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {policies.map((p) => (
              <span key={p.id} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700">
                {p.name} — {p.type.replace(/_/g, ' ')}
                {p.isDefault && <span className="ml-1 font-semibold text-amber-600">(default)</span>}
              </span>
            ))}
            {policies.length === 0 && <span className="text-xs text-slate-500">No policies configured yet — visa applications will earn no incentive until one exists.</span>}
          </div>
          <PolicyForm onCreated={load} />
        </div>

        <div className="mt-8 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Visa Service Catalog</h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure country/visa-type packages with real costing — margin is calculated
              automatically as selling price minus company cost.
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {showCreate ? 'Cancel' : '+ New Visa Service'}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
          >
            <input required placeholder="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input required placeholder="Visa type (e.g. Tourist)" value={form.visaType} onChange={(e) => setForm({ ...form, visaType: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Category" value={form.visaCategory} onChange={(e) => setForm({ ...form, visaCategory: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Entry type (Single/Multiple)" value={form.entryType} onChange={(e) => setForm({ ...form, entryType: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Processing time (e.g. 10-15 days)" value={form.processingTime} onChange={(e) => setForm({ ...form, processingTime: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Validity period" value={form.validityPeriod} onChange={(e) => setForm({ ...form, validityPeriod: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Supplier / embassy" value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" placeholder="Supplier cost (₦)" value={form.supplierCost} onChange={(e) => setForm({ ...form, supplierCost: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input required type="number" placeholder="Company cost (₦)" value={form.companyCost} onChange={(e) => setForm({ ...form, companyCost: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input required type="number" placeholder="Selling price (₦)" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" placeholder="Processing fee (₦)" value={form.processingFee} onChange={(e) => setForm({ ...form, processingFee: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" placeholder="Other fees (₦)" value={form.otherFees} onChange={(e) => setForm({ ...form, otherFees: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <select value={form.incentivePolicyId} onChange={(e) => setForm({ ...form, incentivePolicyId: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">No incentive policy (no incentive earned)</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <input type="checkbox" checked={form.requiresGuarantor} onChange={(e) => setForm({ ...form, requiresGuarantor: e.target.checked })} />
              Requires a guarantor
            </label>
            <textarea placeholder="Required documents (free text)" value={form.requiredDocuments} onChange={(e) => setForm({ ...form, requiredDocuments: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-4" rows={2} />
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-4" rows={2} />
            {form.companyCost && form.sellingPrice && (
              <p className="col-span-2 text-sm text-slate-600 sm:col-span-4">
                Margin preview: {formatCurrency(Number(form.sellingPrice) - Number(form.companyCost), 'NGN')}
              </p>
            )}
            <button type="submit" disabled={creating} className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-4">
              {creating ? 'Creating…' : 'Create visa service (starts as Draft)'}
            </button>
          </form>
        )}

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Service</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Company Cost</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Selling Price</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Margin</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Guarantor</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services?.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-slate-800">{s.country} — {s.visaType}</p>
                    <p className="text-xs text-slate-500">{s.serviceCode}{s.incentivePolicy ? ` · ${s.incentivePolicy.name}` : ''}</p>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(s.companyCost, s.currency)}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(s.sellingPrice, s.currency)}</td>
                  <td className={`px-4 py-2 text-right font-medium ${s.margin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatCurrency(s.margin, s.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleUpdate(s.id, { requiresGuarantor: !s.requiresGuarantor })}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.requiresGuarantor ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {s.requiresGuarantor ? 'Required' : 'Not required'}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={s.status}
                      onChange={(e) => handleUpdate(s.id, { status: e.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {services?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No visa services yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
