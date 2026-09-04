'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';

interface Category {
  id: string;
  name: string;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
  createdAt: string;
  category: { name: string };
  assignedStaff: { firstName: string; lastName: string } | null;
}

interface TicketMessage {
  id: string;
  authorType: 'CUSTOMER' | 'STAFF';
  message: string;
  createdAt: string;
}

interface TicketDetail extends Ticket {
  description: string;
  messages: TicketMessage[];
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-slate-100 text-slate-700',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  WAITING_FOR_CUSTOMER: 'bg-amber-100 text-amber-800',
  WAITING_FOR_STAFF: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-600',
};

export default function PortalSupportPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  function load() {
    apiRequest<Ticket[]>('/support/tickets/me')
      .then(setTickets)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load your tickets'));
  }

  useEffect(load, []);
  useEffect(() => {
    apiRequest<Category[]>('/support/config/categories')
      .then((cats) => {
        setCategories(cats);
        if (cats[0]) setCategoryId(cats[0].id);
      })
      .catch(() => undefined);
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/support/tickets/me', {
        method: 'POST',
        body: { subject, categoryId, priority, description },
      });
      setSubject('');
      setDescription('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open ticket');
    } finally {
      setSubmitting(false);
    }
  }

  async function openTicket(id: string) {
    try {
      const detail = await apiRequest<TicketDetail>(`/support/tickets/me/${id}`);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ticket');
    }
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      await apiRequest(`/support/tickets/me/${selected.id}/messages`, {
        method: 'POST',
        body: { message: reply },
      });
      setReply('');
      openTicket(selected.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Support" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Support</h2>
        <p className="mt-1 text-sm text-slate-500">Open a ticket and chat with our team here — replies arrive by email too.</p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-xs text-slate-500">
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>
          <label className="text-xs text-slate-500 sm:col-span-2">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              Open ticket
            </button>
          </div>
        </form>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {tickets?.map((t) => (
              <button
                key={t.id}
                onClick={() => openTicket(t.id)}
                className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left text-sm hover:bg-slate-50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{t.ticketNumber}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? 'bg-slate-100 text-slate-700'}`}>
                    {t.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{t.subject}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {t.category.name} · {formatDateTime(t.createdAt)}
                </p>
              </button>
            ))}
            {tickets?.length === 0 && <p className="text-sm text-slate-500">No support tickets yet.</p>}
          </div>

          {selected && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">{selected.ticketNumber}</h3>
              <p className="text-xs text-slate-500">{selected.subject}</p>

              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                {selected.messages.map((m) => (
                  <div key={m.id} className={`rounded-lg p-2 text-xs ${m.authorType === 'CUSTOMER' ? 'bg-slate-100' : 'bg-blue-50'}`}>
                    <p className="font-medium text-slate-700">
                      {m.authorType === 'CUSTOMER' ? 'You' : 'Alnajoum Support'}
                      <span className="ml-2 font-normal text-slate-400">{formatDateTime(m.createdAt)}</span>
                    </p>
                    <p className="mt-1 text-slate-700">{m.message}</p>
                  </div>
                ))}
              </div>

              {selected.status !== 'CLOSED' && (
                <form onSubmit={sendReply} className="mt-3 space-y-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    required
                    rows={3}
                    className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="Type a message…"
                  />
                  <button type="submit" disabled={sending} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    Send
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
