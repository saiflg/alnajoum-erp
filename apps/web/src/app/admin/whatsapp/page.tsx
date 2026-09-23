'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface ConversationRow {
  id: string;
  phoneNumber: string;
  status: string;
  lastMessageAt: string | null;
  customer: { firstName: string; lastName: string } | null;
  assignedStaff: { firstName: string; lastName: string } | null;
  messages: Array<{ content: string | null; direction: string }>;
}

interface MessageRow {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string | null;
  isInternalNote: boolean;
  status: string;
  createdAt: string;
  sentByStaff: { firstName: string; lastName: string } | null;
}

const STATUS_OPTIONS = [
  'OPEN',
  'PENDING',
  'ASSIGNED',
  'WAITING_CUSTOMER',
  'WAITING_STAFF',
  'RESOLVED',
  'CLOSED',
];

/**
 * Phase 14 spec #32/#64/#65 — the staff WhatsApp inbox. A genuinely
 * working two-pane conversation list + thread view, deliberately not
 * the full enterprise layout the spec sketches (SLA countdowns, tags,
 * linked-booking panel) — see WhatsAppModule's own doc comment for what
 * this increment builds vs. defers.
 */
export default function WhatsAppInboxPage() {
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [reply, setReply] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  function loadConversations() {
    const query = statusFilter ? `?status=${statusFilter}` : '';
    apiRequest<ConversationRow[]>(`/whatsapp/conversations${query}`)
      .then(setConversations)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(loadConversations, [statusFilter]);

  function loadMessages(id: string) {
    apiRequest<MessageRow[]>(`/whatsapp/conversations/${id}/messages`)
      .then((rows) => setMessages([...rows].reverse()))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load messages'));
  }

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
  }, [selectedId]);

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || reply.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      await apiRequest(`/whatsapp/conversations/${selectedId}/${isNote ? 'notes' : 'reply'}`, {
        method: 'POST',
        body: { body: reply },
      });
      setReply('');
      loadMessages(selectedId);
      loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function handleSuggestReply() {
    if (!selectedId) return;
    setSuggesting(true);
    setError(null);
    try {
      const result = await apiRequest<{ suggestion: string; provider: string }>(
        `/whatsapp/conversations/${selectedId}/suggest-reply`,
        { method: 'POST' },
      );
      setIsNote(false);
      setReply(result.suggestion);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to draft a suggestion');
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAssignToMe() {
    if (!selectedId) return;
    try {
      await apiRequest(`/whatsapp/conversations/${selectedId}/assign-to-me`, {
        method: 'POST',
      });
      loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign');
    }
  }

  async function handleStatusChange(status: string) {
    if (!selectedId) return;
    try {
      await apiRequest(`/whatsapp/conversations/${selectedId}/status`, {
        method: 'PATCH',
        body: { status },
      });
      loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    }
  }

  return (
    <ProtectedRoute
      allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}
    >
      <AppShell title="WhatsApp Inbox" navLinks={ADMIN_NAV}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">WhatsApp Inbox</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]" style={{ minHeight: 480 }}>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100 overflow-y-auto" style={{ maxHeight: 560 }}>
              {conversations?.map((c) => {
                const lastMessage = c.messages[0];
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50 ${
                        selectedId === c.id ? 'bg-amber-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800">
                          {c.customer ? `${c.customer.firstName} ${c.customer.lastName}` : c.phoneNumber}
                        </span>
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          {c.status}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {lastMessage?.content ?? 'No messages yet'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {c.assignedStaff
                          ? `${c.assignedStaff.firstName} ${c.assignedStaff.lastName}`
                          : 'Unassigned'}
                      </p>
                    </button>
                  </li>
                );
              })}
              {conversations?.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-slate-500">
                  No conversations yet.
                </li>
              )}
            </ul>
          </div>

          <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                Select a conversation
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {selected.customer
                        ? `${selected.customer.firstName} ${selected.customer.lastName}`
                        : selected.phoneNumber}
                    </p>
                    <p className="text-xs text-slate-400">{selected.phoneNumber}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAssignToMe}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Assign to me
                    </button>
                    <select
                      value={selected.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" style={{ maxHeight: 400 }}>
                  {messages?.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.isInternalNote
                          ? 'ml-auto bg-yellow-50 text-yellow-900'
                          : m.direction === 'OUTBOUND'
                            ? 'ml-auto bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {m.isInternalNote && (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-700">
                          Internal note
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <p className="mt-1 text-[10px] opacity-70">
                        {m.sentByStaff && `${m.sentByStaff.firstName} · `}
                        {formatDateTime(m.createdAt)} · {m.status}
                      </p>
                    </div>
                  ))}
                  {messages?.length === 0 && (
                    <p className="py-8 text-center text-sm text-slate-400">No messages yet.</p>
                  )}
                </div>

                <form onSubmit={handleSend} className="border-t border-slate-100 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <label className="flex items-center gap-1 text-slate-500">
                      <input
                        type="checkbox"
                        checked={isNote}
                        onChange={(e) => setIsNote(e.target.checked)}
                      />
                      Internal note (never sent to the customer)
                    </label>
                    <button
                      type="button"
                      onClick={handleSuggestReply}
                      disabled={suggesting}
                      title="AI drafts a reply for you to review and edit — it's never sent automatically"
                      className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {suggesting ? 'Drafting…' : '✨ Suggest reply'}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder={isNote ? 'Write an internal note…' : 'Type a reply…'}
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={sending || reply.trim().length === 0}
                      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {sending ? 'Sending…' : isNote ? 'Add Note' : 'Send'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
