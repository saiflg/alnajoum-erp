'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { StaffMember } from '@/lib/types';

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<StaffMember[]>('/staff')
      .then(setStaff)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Staff" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Staff</h2>
          <Link
            href="/admin/staff/new"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Staff Member
          </Link>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Employee Code</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Email</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff?.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {member.firstName} {member.lastName}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{member.employeeCode}</td>
                  <td className="px-4 py-2 text-slate-600">{member.identity?.email ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        member.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {member.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {staff?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                    No staff members yet.
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
