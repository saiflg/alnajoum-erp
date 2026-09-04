'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';

type LeadSource =
  | 'WEBSITE'
  | 'WHATSAPP'
  | 'PHONE'
  | 'WALK_IN'
  | 'SOCIAL_MEDIA'
  | 'REFERRAL'
  | 'STAFF'
  | 'ADVERTISEMENT'
  | 'MANUAL_ENTRY';

interface Stage {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}

interface Lead {
  id: string;
  leadNumber: string;
  name: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  interestedService: string | null;
  budget: number | null;
  currency: string;
  status: 'OPEN' | 'CONVERTED' | 'LOST';
  priority: string;
  stageId: string;
  stage: { id: string; name: string };
  assignedStaff: { firstName: string; lastName: string } | null;
}

const SOURCES: LeadSource[] = [
  'WEBSITE',
  'WHATSAPP',
  'PHONE',
  'WALK_IN',
  'SOCIAL_MEDIA',
  'REFERRAL',
  'STAFF',
  'ADVERTISEMENT',
  'MANUAL_ENTRY',
];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<LeadSource>('WEBSITE');
  const [interestedService, setInterestedService] = useState('');
  const [budget, setBudget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    apiRequest<Lead[]>('/crm/leads')
      .then(setLeads)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load leads'));
    apiRequest<Stage[]>('/crm/leads/stages').then(setStages).catch(() => undefined);
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/crm/leads', {
        method: 'POST',
        body: {
          name,
          phone,
          email: email || undefined,
          source,
          interestedService: interestedService || undefined,
          budget: budget ? Number(budget) : undefined,
        },
      });
      setName('');
      setPhone('');
      setEmail('');
      setInterestedService('');
      setBudget('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create lead');
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStage(id: string, stageId: string) {
    setBusyId(id);
    try {
      await apiRequest(`/crm/leads/${id}/stage`, { method: 'POST', body: { stageId } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change stage');
    } finally {
      setBusyId(null);
    }
  }

  async function convert(id: string) {
    if (!confirm('Convert this lead to a customer? An existing customer with the same phone/email will be reused.')) return;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/crm/leads/${id}/convert`, { method: 'POST', body: {} });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to convert this lead');
    } finally {
      setBusyId(null);
    }
  }

  async function markLost(id: string) {
    const reason = prompt('Reason this lead was lost:');
    if (!reason) return;
    setBusyId(id);
    try {
      await apiRequest(`/crm/leads/${id}/lost`, { method: 'POST', body: { reason } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark this lead lost');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Leads" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Lead Management</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs text-slate-500">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Source
            <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Interested service
            <input value={interestedService} onChange={(e) => setInterestedService(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Budget (NGN)
            <input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2 lg:col-span-6">
            <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              Add lead
            </button>
          </div>
        </form>

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Lead #</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Contact</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Interested In</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Budget</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Stage</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Assigned</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads?.map((lead) => (
                <tr key={lead.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{lead.leadNumber}</td>
                  <td className="px-3 py-2 text-slate-700">{lead.name}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {lead.phone}
                    {lead.email ? ` · ${lead.email}` : ''}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{lead.interestedService ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    {lead.budget ? formatCurrency(lead.budget, lead.currency) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {lead.status === 'OPEN' ? (
                      <select
                        value={lead.stageId}
                        disabled={busyId === lead.id}
                        onChange={(e) => changeStage(lead.id, e.target.value)}
                        className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
                      >
                        {stages?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          lead.status === 'CONVERTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {lead.status}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {lead.assignedStaff ? `${lead.assignedStaff.firstName} ${lead.assignedStaff.lastName}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {lead.status === 'OPEN' && (
                      <div className="flex gap-2">
                        <button disabled={busyId === lead.id} onClick={() => convert(lead.id)} className="text-emerald-600 hover:underline disabled:opacity-50">
                          Convert
                        </button>
                        <button disabled={busyId === lead.id} onClick={() => markLost(lead.id)} className="text-red-600 hover:underline disabled:opacity-50">
                          Mark lost
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {leads?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    No leads yet.
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
