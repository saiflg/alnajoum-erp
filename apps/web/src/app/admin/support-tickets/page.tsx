'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

type TicketStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_CUSTOMER'
  | 'WAITING_FOR_STAFF'
  | 'RESOLVED'
  | 'CLOSED';

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: TicketStatus;
  slaBreached: boolean;
  slaResponseDueAt: string | null;
  createdAt: string;
  customer: { firstName: string; lastName: string };
  category: { name: string };
  assignedStaff: { firstName: string; lastName: string } | null;
}

interface TicketMessage {
  id: string;
  authorType: 'CUSTOMER' | 'STAFF';
  message: string;
  isInternal: boolean;
  createdAt: string;
  authorStaff: { firstName: string; lastName: string } | null;
}

interface TicketDetail extends Ticket {
  description: string;
  messages: TicketMessage[];
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  OPEN: 'bg-slate-100 text-slate-700',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  WAITING_FOR_CUSTOMER: 'bg-amber-100 text-amber-800',
  WAITING_FOR_STAFF: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-600',
};

export default function SupportTicketsPage() {
  const { user } = useAuth();
  const myStaffId = (user?.profile as { id?: string } | null)?.id;

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  function load() {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    apiRequest<Ticket[]>(`/support/tickets${params}`)
      .then(setTickets)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load tickets'));
  }

  useEffect(load, [statusFilter]);

  async function openTicket(id: string) {
    try {
      const detail = await apiRequest<TicketDetail>(`/support/tickets/${id}`);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ticket');
    }
  }

  async function assignToMe(id: string) {
    if (!myStaffId) return;
    try {
      await apiRequest(`/support/tickets/${id}/assign`, { method: 'POST', body: { staffId: myStaffId } });
      load();
      openTicket(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign ticket');
    }
  }

  async function setStatus(id: string, status: TicketStatus) {
    try {
      await apiRequest(`/support/tickets/${id}/status`, { method: 'POST', body: { status } });
      load();
      openTicket(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    }
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      await apiRequest(`/support/tickets/${selected.id}/messages`, {
        method: 'POST',
        body: { message: reply, isInternal },
      });
      setReply('');
      setIsInternal(false);
      openTicket(selected.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Support Tickets" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Support Tickets</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          {(['', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_STAFF', 'RESOLVED', 'CLOSED'] as const).map((s) => (
            <button
              key={s || 'ALL'}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {s ? s.replace(/_/g, ' ') : 'All'}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Ticket</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Customer</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Priority</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickets?.map((t) => (
                  <tr key={t.id} onClick={() => openTicket(t.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {t.ticketNumber}
                      {t.slaBreached && <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-red-700">SLA breached</span>}
                      <div className="text-slate-500">{t.subject}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {t.customer.firstName} {t.customer.lastName}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{t.priority}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status]}`}>{t.status.replace(/_/g, ' ')}</span>
                    </td>
                  </tr>
                ))}
                {tickets?.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                      No tickets.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{selected.ticketNumber}</h3>
                  <p className="text-xs text-slate-500">{selected.subject}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[selected.status]}`}>{selected.status.replace(/_/g, ' ')}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {!selected.assignedStaff && (
                  <button onClick={() => assignToMe(selected.id)} className="rounded-md bg-slate-900 px-2 py-1 text-white">
                    Assign to me
                  </button>
                )}
                {selected.status !== 'RESOLVED' && selected.status !== 'CLOSED' && (
                  <button onClick={() => setStatus(selected.id, 'RESOLVED')} className="rounded-md bg-emerald-600 px-2 py-1 text-white">
                    Mark resolved
                  </button>
                )}
                {selected.status === 'RESOLVED' && (
                  <button onClick={() => setStatus(selected.id, 'CLOSED')} className="rounded-md bg-slate-600 px-2 py-1 text-white">
                    Close
                  </button>
                )}
              </div>

              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-2 text-xs ${
                      m.isInternal ? 'border border-dashed border-amber-300 bg-amber-50' : m.authorType === 'CUSTOMER' ? 'bg-slate-100' : 'bg-blue-50'
                    }`}
                  >
                    <p className="font-medium text-slate-700">
                      {m.isInternal ? 'INTERNAL NOTE' : m.authorType === 'CUSTOMER' ? 'CUSTOMER MESSAGE' : m.authorStaff ? `${m.authorStaff.firstName} ${m.authorStaff.lastName}` : 'Staff'}
                      <span className="ml-2 font-normal text-slate-400">{formatDateTime(m.createdAt)}</span>
                    </p>
                    <p className="mt-1 text-slate-700">{m.message}</p>
                  </div>
                ))}
              </div>

              <form onSubmit={sendReply} className="mt-3 space-y-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  required
                  rows={3}
                  className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Type a reply…"
                />
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                  Internal note (never visible to the customer)
                </label>
                <button type="submit" disabled={sending} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
