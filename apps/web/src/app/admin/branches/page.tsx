'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { Branch, Company } from '@/lib/types';

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiRequest<Branch[]>('/branches'), apiRequest<Company[]>('/companies')])
      .then(([branchData, companyData]) => {
        setBranches(branchData);
        setCompanies(companyData);
      })
      .catch((err) => setError(err.message));
  }, []);

  function companyName(companyId: string) {
    return companies.find((c) => c.id === companyId)?.name ?? companyId;
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Branches" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Branches</h2>
          <Link
            href="/admin/branches/new"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Branch
          </Link>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Code</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Company</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">City</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">HQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branches?.map((branch) => (
                <tr key={branch.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{branch.name}</td>
                  <td className="px-4 py-2 text-slate-600">{branch.code}</td>
                  <td className="px-4 py-2 text-slate-600">{companyName(branch.companyId)}</td>
                  <td className="px-4 py-2 text-slate-600">{branch.city ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{branch.isHeadOffice ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {branches?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    No branches yet.
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
