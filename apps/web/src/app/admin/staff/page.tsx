'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Field, Modal, Msg, btn, btnDanger, btnGhost, input, useAction } from '@/components/comm/ui';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Branch, StaffMember } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super administrator',
  COMPANY_ADMIN: 'Company administrator',
  BRANCH_MANAGER: 'Branch manager',
  FINANCE_OFFICER: 'Finance officer',
  AUDITOR: 'Auditor',
  STAFF: 'Staff',
};
const roleLabel = (name: string) => ROLE_LABEL[name] ?? name.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

interface RoleRow { id: string; name: string; description?: string | null }
interface HistoryRow { id: string; action: string; reason: string | null; details: Record<string, unknown> | null; at: string; by: string | null }

function describe(h: HistoryRow): string {
  const d = h.details ?? {};
  switch (h.action) {
    case 'staff.transferred':
      return `Moved from ${(d.fromBranch as string) ?? 'no branch'} to ${(d.toBranch as string) ?? 'no branch'}`;
    case 'staff.role_changed':
      return `Role changed from ${((d.from as string[]) ?? []).map(roleLabel).join(', ') || 'none'} to ${roleLabel(String(d.to ?? ''))}`;
    case 'staff.removed':
      return 'Removed';
    case 'staff.reactivated':
      return 'Restored';
    case 'staff.password_reset':
      return 'A new temporary password was issued';
    default:
      return h.action;
  }
}

function ManageModal({ member, onClose, onChanged }: { member: StaffMember; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [branchId, setBranchId] = useState(member.branchId ?? '');
  const [roleId, setRoleId] = useState('');
  const [reason, setReason] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { act, error, notice, busy } = useAction(() => {
    setRefresh((n) => n + 1);
    onChanged();
  });
  const currentRoles = member.identity?.roles?.map((r) => r.role.name) ?? [];

  useEffect(() => {
    apiRequest<Branch[]>('/branches').then(setBranches).catch(() => undefined);
    apiRequest<RoleRow[]>('/rbac/roles').then(setRoles).catch(() => undefined);
  }, []);
  useEffect(() => {
    apiRequest<HistoryRow[]>(`/staff/${member.id}/history`).then(setHistory).catch(() => undefined);
  }, [member.id, refresh]);

  const assignable = roles.filter((r) => r.name !== 'CUSTOMER' && (r.name !== 'SUPER_ADMIN' || user?.roles.includes('SUPER_ADMIN')));
  const companyBranches = branches.filter((b) => b.companyId === member.companyId && b.isActive);
  const reasonField = (
    <Field label="Reason (kept on the record, optional)">
      <input className={input} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: promoted after one year" />
    </Field>
  );

  return (
    <Modal title={`Manage ${member.firstName} ${member.lastName}`} onClose={onClose} wide>
      <div className="space-y-5 text-sm text-slate-700">
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
          Now: <strong>{currentRoles.length ? currentRoles.map(roleLabel).join(', ') : 'no role'}</strong>
          {' · '}
          {member.branch?.name ?? 'no branch'}
          {' · '}
          {member.identity?.email}
        </p>
        <Msg error={error} notice={notice} />

        {can('staff:transfer') && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Move to another branch</h3>
            <select className={input} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">— no branch —</option>
              {companyBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="text-[11px] text-slate-400">Past bookings and payments stay with the branch they happened in. A printed ID card shows the old branch until it is printed again.</p>
            <button className={btnGhost} disabled={busy || branchId === (member.branchId ?? '')} onClick={() => act(() => apiRequest(`/staff/${member.id}/transfer`, { method: 'POST', body: { branchId: branchId || null, reason: reason.trim() || undefined } }), 'Moved.')}>
              Move
            </button>
          </section>
        )}

        {can('staff:change_role') && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Promote or demote (change role)</h3>
            <select className={input} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Choose the new role…</option>
              {assignable.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}{currentRoles.includes(r.name) ? ' (current)' : ''}</option>)}
            </select>
            <p className="text-[11px] text-slate-400">The person gets exactly this role, in place of the one they have. It applies the next time they open a page. You cannot give a role stronger than your own.</p>
            <button className={btnGhost} disabled={busy || !roleId} onClick={() => act(() => apiRequest(`/staff/${member.id}/role`, { method: 'POST', body: { roleId, reason: reason.trim() || undefined } }), 'Role changed.')}>
              Change role
            </button>
          </section>
        )}

        {(can('staff:transfer') || can('staff:change_role')) && reasonField}

        {can('staff:reset_password') && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Forgot their password?</h3>
            <p className="text-[11px] text-slate-500">
              A password cannot be looked up, because it is never stored in a readable form. Instead, give them a new temporary one. They must choose their own the first time they sign in, and any sign-in they have open ends now.
            </p>
            {tempPassword ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-900">Give this to {member.firstName} in person or by phone. It is shown only once.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="select-all rounded bg-white px-2 py-1 font-mono text-sm text-slate-900 ring-1 ring-amber-200">{tempPassword}</code>
                  <button className={btnGhost} onClick={() => navigator.clipboard?.writeText(tempPassword).then(() => setCopied(true)).catch(() => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
                <p className="mt-2 text-[11px] text-amber-800">Sign-in email: {member.identity?.email}</p>
              </div>
            ) : (
              <button
                className={btnGhost}
                disabled={busy}
                onClick={() => act(async () => {
                  const r = await apiRequest<{ temporaryPassword: string }>(`/staff/${member.id}/reset-password`, { method: 'POST' });
                  setTempPassword(r.temporaryPassword);
                  setCopied(false);
                })}
              >
                Give a new temporary password
              </button>
            )}
          </section>
        )}

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400">No moves, role changes or resets recorded yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {history.map((h) => (
                <li key={h.id} className="rounded border border-slate-100 px-2 py-1.5">
                  <span className="font-medium text-slate-800">{describe(h)}</span>
                  {h.reason && <span className="text-slate-500"> — {h.reason}</span>}
                  <span className="block text-[11px] text-slate-400">{new Date(h.at).toLocaleString()}{h.by ? ` · by ${h.by}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function StaffList() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { act, error: actError, notice, busy } = useAction(() => setRefresh((n) => n + 1));
  const can = (p: string) => !!user?.permissions.includes(p);
  const canRemove = can('staff:delete');
  const canManage = can('staff:transfer') || can('staff:change_role') || can('staff:reset_password');

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
  const managed = staff?.find((m) => m.id === managing) ?? null;

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

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Role</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Branch</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Employee Code</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((member) => {
              const isMe = member.identityId === user?.id;
              const memberRoles = member.identity?.roles?.map((r) => roleLabel(r.role.name)).join(', ') || '—';
              return (
                <tr key={member.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {member.firstName} {member.lastName}
                    {isMe && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{memberRoles}</td>
                  <td className="px-4 py-2 text-slate-600">{member.branch?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{member.employeeCode}</td>
                  <td className="px-4 py-2 text-slate-600">{member.identity?.email ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${member.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {member.isActive ? 'Active' : 'Removed'}
                    </span>
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-4 py-2 text-right">
                    <a href={`/admin/staff-cards?search=${encodeURIComponent(member.employeeCode)}`} className="text-xs font-medium text-amber-700 hover:underline">
                      ID Card
                    </a>
                    {canManage && member.isActive && !isMe && (
                      <button className="text-xs font-medium text-slate-700 hover:underline" disabled={busy} onClick={() => setManaging(member.id)}>
                        Manage
                      </button>
                    )}
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
                <td className="px-4 py-6 text-center text-slate-500" colSpan={7}>
                  No staff members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {managed && <ManageModal member={managed} onClose={() => setManaging(null)} onChanged={() => setRefresh((n) => n + 1)} />}

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
