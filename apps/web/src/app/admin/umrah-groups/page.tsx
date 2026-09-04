'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import type { HajjOpsGroup, UmrahGroupType } from '@/lib/hajj-ops-types';

interface UmrahPackageOption {
  id: string;
  name: string;
}

const GROUP_TYPES: UmrahGroupType[] = ['INDIVIDUAL', 'FAMILY', 'GROUP', 'CORPORATE', 'VIP'];

export default function UmrahGroupsPage() {
  const { user } = useAuth();
  const canManage = user?.permissions.includes('hajj_ops:group_manage') ?? false;

  const [groups, setGroups] = useState<HajjOpsGroup[] | null>(null);
  const [packages, setPackages] = useState<UmrahPackageOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<UmrahGroupType>('GROUP');
  const [packageId, setPackageId] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [maxCapacity, setMaxCapacity] = useState('20');

  function load() {
    apiRequest<HajjOpsGroup[]>('/hajj-ops/umrah-groups')
      .then(setGroups)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load groups'));
    apiRequest<UmrahPackageOption[]>('/umrah/packages/admin').then(setPackages).catch(() => undefined);
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/hajj-ops/umrah-groups', {
        method: 'POST',
        body: {
          name,
          groupType,
          packageId: packageId || undefined,
          departureDate: departureDate || undefined,
          maxCapacity: maxCapacity ? Number(maxCapacity) : undefined,
        },
      });
      setName('');
      setDepartureDate('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create group');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Umrah Groups" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Umrah Group Management</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {canManage && (
          <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-xs text-slate-500">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              Type
              <select value={groupType} onChange={(e) => setGroupType(e.target.value as UmrahGroupType)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {GROUP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Package
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">— None —</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Departure date
              <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              Max capacity
              <input type="number" min={1} value={maxCapacity} onChange={(e) => setMaxCapacity(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={submitting} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                Create group
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Group #</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Package</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Departure</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Pilgrims</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups?.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <Link href={`/admin/umrah-groups/${g.id}`} className="hover:underline">
                      {g.groupNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{g.name}</td>
                  <td className="px-3 py-2 text-slate-600">{g.groupType}</td>
                  <td className="px-3 py-2 text-slate-600">{g.package?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{g.departureDate ? formatDateTime(g.departureDate) : '—'}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {g._count?.pilgrims ?? 0}
                    {g.maxCapacity ? ` / ${g.maxCapacity}` : ''}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {g.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {groups?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                    No Umrah groups yet.
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
