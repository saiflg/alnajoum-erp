'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

type ApprovalRequestStatus = 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

interface ApprovalDecision {
  id: string;
  decidedByIdentityId: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string | null;
  createdAt: string;
}

interface ApprovalRequestRow {
  id: string;
  type: string;
  amount: number | null;
  currency: string | null;
  entityType: string | null;
  entityId: string | null;
  reason: string | null;
  status: ApprovalRequestStatus;
  requiredApprovals: number;
  requestedByIdentityId: string;
  decisions: ApprovalDecision[];
  createdAt: string;
  resolvedAt: string | null;
}

const STATUS_STYLES: Record<ApprovalRequestStatus, string> = {
  REQUESTED: 'bg-amber-100 text-amber-700',
  UNDER_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const STATUSES: Array<ApprovalRequestStatus | ''> = [
  '',
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
];

/**
 * Phase 11 spec #10/#11 — the generic multi-level approval engine's
 * review queue. A pending request always needs a DIFFERENT identity to
 * decide it than the one who opened it (self-approval prevention, spec
 * #11); the backend enforces that, this page just surfaces the decision
 * form to whoever holds APPROVAL.DECIDE.
 */
export default function ApprovalsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ApprovalRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ApprovalRequestStatus | ''>('REQUESTED');
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const canDecide = user?.permissions.includes('approval:decide') ?? false;

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<ApprovalRequestRow[]>(`/approvals?${params.toString()}`)
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [statusFilter]);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    const reason = reasonDraft[id]?.trim();
    if (decision === 'REJECTED' && (!reason || reason.length < 3)) {
      setActionError((prev) => ({
        ...prev,
        [id]: 'A rejection needs a reason (at least 3 characters).',
      }));
      return;
    }
    setDecidingId(id);
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await apiRequest(`/approvals/${id}/decide`, {
        method: 'POST',
        body: { decision, reason: reason || undefined },
      });
      load();
    } catch (err) {
      setActionError((prev) => ({
        ...prev,
        [id]: err instanceof ApiError ? err.message : 'Failed to record decision',
      }));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER']}>
      <AppShell title="Approvals" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Approval Requests</h2>
            <p className="mt-1 text-sm text-slate-500">
              Sensitive, amount-based actions routed through configurable
              approval thresholds — a request always needs someone other
              than its requester to decide it.
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ApprovalRequestStatus | '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All statuses'}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          {requests?.map((req) => {
            const pending = req.status === 'REQUESTED' || req.status === 'UNDER_REVIEW';
            const alreadyDecidedByMe = req.decisions.some(
              (d) => d.decidedByIdentityId === user?.id,
            );
            return (
              <div key={req.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900">{req.type}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[req.status]}`}
                      >
                        {req.status.replace('_', ' ')}
                      </span>
                    </div>
                    {req.entityType && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {req.entityType} · {req.entityId}
                      </p>
                    )}
                    {req.reason && (
                      <p className="mt-1 text-sm text-slate-600">&ldquo;{req.reason}&rdquo;</p>
                    )}
                  </div>
                  <div className="text-right">
                    {req.amount !== null && (
                      <p className="font-mono text-sm text-slate-900">
                        {req.currency} {req.amount.toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-slate-400">{formatDateTime(req.createdAt)}</p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {req.decisions.length} of {req.requiredApprovals} approval(s) recorded
                </p>
                {req.decisions.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {req.decisions.map((d) => (
                      <li key={d.id}>
                        {d.decision === 'APPROVED' ? '✓' : '✕'} {d.decision.toLowerCase()}
                        {d.reason ? ` — ${d.reason}` : ''} ({formatDateTime(d.createdAt)})
                      </li>
                    ))}
                  </ul>
                )}

                {pending && canDecide && !alreadyDecidedByMe && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <input
                      value={reasonDraft[req.id] ?? ''}
                      onChange={(e) =>
                        setReasonDraft((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      placeholder="Reason (required to reject)"
                      className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => decide(req.id, 'APPROVED')}
                      disabled={decidingId === req.id}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => decide(req.id, 'REJECTED')}
                      disabled={decidingId === req.id}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {pending && alreadyDecidedByMe && (
                  <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
                    You already recorded a decision on this request — waiting on another approver.
                  </p>
                )}
                {actionError[req.id] && (
                  <p className="mt-2 text-xs text-red-600">{actionError[req.id]}</p>
                )}
              </div>
            );
          })}
          {requests?.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              No approval requests {statusFilter ? `with status ${statusFilter}` : ''} found.
            </p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
