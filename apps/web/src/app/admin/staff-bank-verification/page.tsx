'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';

interface UnverifiedStaff {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

export default function StaffBankVerificationPage() {
  const [staff, setStaff] = useState<UnverifiedStaff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiRequest<UnverifiedStaff[]>('/finance/staff-bank-accounts/unverified')
      .then(setStaff)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load unverified accounts'));
  }

  useEffect(load, []);

  async function verify(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/finance/staff-bank-accounts/${id}/verify`, { method: 'POST', body: {} });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to verify this account');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Staff Bank Verification" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Staff Payout Bank Account Verification</h2>
        <p className="mt-1 text-sm text-slate-500">
          A payout cannot be attempted until Finance verifies the account here. Any later change to the account details resets verification automatically.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Staff</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Bank</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Account Number</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Account Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff?.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{s.firstName} {s.lastName} ({s.employeeCode})</td>
                  <td className="px-3 py-2 text-slate-600">{s.bankName}</td>
                  <td className="px-3 py-2 text-slate-600">{s.bankAccountNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{s.bankAccountName}</td>
                  <td className="px-3 py-2">
                    <button disabled={busyId === s.id} onClick={() => verify(s.id)} className="text-emerald-600 hover:underline disabled:opacity-50">
                      Verify
                    </button>
                  </td>
                </tr>
              ))}
              {staff?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                    No staff awaiting bank account verification.
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
