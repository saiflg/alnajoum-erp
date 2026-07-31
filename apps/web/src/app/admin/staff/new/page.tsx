'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { Branch, Company, Role } from '@/lib/types';

interface CreateStaffResult {
  email: string;
  temporaryPassword: string;
}

export default function NewStaffPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [roleId, setRoleId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateStaffResult | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<Company[]>('/companies'),
      apiRequest<Branch[]>('/branches'),
      apiRequest<Role[]>('/rbac/roles'),
    ]).then(([companyData, branchData, roleData]) => {
      setCompanies(companyData);
      setBranches(branchData);
      setRoles(roleData.filter((r) => r.name !== 'CUSTOMER'));
      if (companyData.length > 0) setCompanyId(companyData[0].id);
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiRequest<CreateStaffResult>('/staff', {
        method: 'POST',
        body: {
          email,
          firstName,
          lastName,
          companyId,
          branchId: branchId || undefined,
          employeeCode,
          roleId,
        },
      });
      setResult(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create staff member');
    } finally {
      setSubmitting(false);
    }
  }

  const companyBranches = branches.filter((b) => b.companyId === companyId);

  if (result) {
    return (
      <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
        <AppShell title="New Staff Member" navLinks={ADMIN_NAV}>
          <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Staff account created</h2>
            <p className="mt-2 text-sm text-slate-700">
              Share these temporary credentials with the new staff member. This
              password will not be shown again.
            </p>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="font-medium text-slate-600">Email:</dt>
                <dd className="text-slate-900">{result.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium text-slate-600">Temporary password:</dt>
                <dd className="font-mono text-slate-900">{result.temporaryPassword}</dd>
              </div>
            </dl>
            <Link
              href="/admin/staff"
              className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Back to Staff
            </Link>
          </div>
        </AppShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="New Staff Member" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">New Staff Member</h2>

        <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">First name</label>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Last name</label>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Employee code</label>
            <input
              required
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Company</label>
            <select
              required
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setBranchId('');
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Branch (optional)</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">— None —</option>
              {companyBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Role</label>
            <select
              required
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">— Select a role —</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !companyId || !roleId}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Staff Member'}
          </button>
        </form>
      </AppShell>
    </ProtectedRoute>
  );
}
