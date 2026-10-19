'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Field, Modal, Msg, btn, btnDanger, btnGhost, input, useAction } from '@/components/comm/ui';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { StaffMember } from '@/lib/types';

function StaffList() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [reason, setReason] = useState('');
  const { act, error: actError, notice, busy } = useAction(() => setRefresh((n) => n + 1));
  const canRemove = !!user?.permissions.includes('staff:delete');

  useEffect(() => {
    apiRequest<StaffMember[]>('/staff')
      .then((rows) => {
        setStaff(rows);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [refresh]);

  const rows = (staff ?? []).filter((m) => showInactive || m.isActive);
  const hiddenCount = (staff ?? []).filter((m) => !m.isActive).length;

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Staff</h2>
        <Link href="/admin/staff/new" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
          New Staff Member
        </Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <Msg error={actError} notice={notice} />

      {hiddenCount > 0 && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show removed staff ({hiddenCount})
        </label>
      )}

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Employee Code</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((member) => {
              const isMe = member.identityId === user?.id;
              return (
                <tr key={member.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {member.firstName} {member.lastName}
                    {isMe && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{member.employeeCode}</td>
                  <td className="px-4 py-2 text-slate-600">{member.identity?.email ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${member.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {member.isActive ? 'Active' : 'Removed'}
                    </span>
                  </td>
                  <td className="space-x-3 px-4 py-2 text-right">
                    <a href={`/admin/staff-cards?search=${encodeURIComponent(member.employeeCode)}`} className="text-xs font-medium text-amber-700 hover:underline">
                      ID Card
                    </a>
                    {canRemove && member.isActive && !isMe && (
                      <button className="text-xs font-medium text-red-700 hover:underline" disabled={busy} onClick={() => { setReason(''); setRemoving(member); }}>
                        Remove
                      </button>
                    )}
                    {canRemove && !member.isActive && (
                      <button
                        className="text-xs font-medium text-emerald-700 hover:underline"
                        disabled={busy}
                        onClick={() => act(() => apiRequest(`/staff/${member.id}/reactivate`, { method: 'POST' }), `${member.firstName} ${member.lastName} can sign in again. Issue a new ID card if they need one.`)}
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {staff && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                  No staff members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {removing && (
        <Modal title={`Remove ${removing.firstName} ${removing.lastName}?`} onClose={() => setRemoving(null)}>
          <div className="space-y-3 text-sm text-slate-700">
            <p>This person will no longer be able to sign in, every session they have open ends now, and their identification cards stop working.</p>
            <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              Their name stays on the bookings, payments, incentives and records they were part of. Nothing is erased, so the books still add up. You can restore them later from <strong>Show removed staff</strong>.
            </p>
            <Field label="Reason (kept in the audit log, optional)">
              <input className={input} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: left the company" />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className={btnGhost} onClick={() => setRemoving(null)}>Cancel</button>
              <button
                className={busy ? btn : btnDanger}
                disabled={busy}
                onClick={() => {
                  const m = removing;
                  setRemoving(null);
                  void act(
                    () => apiRequest(`/staff/${m.id}${reason.trim() ? `?reason=${encodeURIComponent(reason.trim())}` : ''}`, { method: 'DELETE' }),
                    `${m.firstName} ${m.lastName} was removed.`,
                  );
                }}
              >
                Remove staff member
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function StaffPage() {
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Staff" navLinks={ADMIN_NAV}>
        <StaffList />
      </AppShell>
    </ProtectedRoute>
  );
}
