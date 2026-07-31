'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { Company } from '@/lib/types';

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<Company[]>('/companies')
      .then(setCompanies)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Companies" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Companies</h2>
          <Link
            href="/admin/companies/new"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Company
          </Link>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Email</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Registration #</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies?.map((company) => (
                <tr key={company.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{company.name}</td>
                  <td className="px-4 py-2 text-slate-600">{company.email ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{company.registrationNumber ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        company.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {company.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {companies?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                    No companies yet.
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
