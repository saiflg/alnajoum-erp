'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { listQueuedCheckIns, queueCheckIn, removeQueuedCheckIn, type QueuedCheckIn } from '@/lib/offline-cache';

const EVENTS = ['GROUP_CHECK_IN', 'AIRPORT', 'TRANSPORT', 'HOTEL', 'DEPARTURE'] as const;
type CheckInEvent = (typeof EVENTS)[number];

interface LogEntry {
  id: string;
  pilgrimCode: string;
  event: CheckInEvent;
  status: 'synced' | 'queued' | 'failed';
  detail?: string;
  at: number;
}

/**
 * Spec #14 (controlled offline caching) — the write side. A ground-staff
 * scan-and-check-in flow that keeps working when the network doesn't:
 * a failed request due to connectivity (not a real 404/permission error)
 * is queued locally and replayed automatically once back online. Never
 * queues the pilgrim's name or passport — only the opaque QR code, the
 * event type, and a timestamp.
 */
export default function HajjOpsCheckInPage() {
  const { user } = useAuth();

  const [pilgrimCode, setPilgrimCode] = useState('');
  const [event, setEvent] = useState<CheckInEvent>('GROUP_CHECK_IN');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<QueuedCheckIn[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshPending = useCallback(async () => {
    if (!user) return;
    setPending(await listQueuedCheckIns(user.id));
  }, [user]);

  const flushOutbox = useCallback(async () => {
    if (!user || syncing) return;
    setSyncing(true);
    try {
      const queue = await listQueuedCheckIns(user.id);
      for (const entry of queue) {
        try {
          await apiRequest('/hajj-ops/checkin/scan', {
            method: 'POST',
            body: { pilgrimCode: entry.pilgrimCode, event: entry.event, location: entry.location },
          });
          await removeQueuedCheckIn(entry.localId);
          setLog((prev) => [
            { id: entry.localId, pilgrimCode: entry.pilgrimCode, event: entry.event as CheckInEvent, status: 'synced', at: Date.now() },
            ...prev,
          ]);
        } catch (err) {
          if (err instanceof ApiError) {
            // A real rejection (e.g. the code doesn't exist) will never
            // succeed by retrying — drop it and tell the operator, rather
            // than queueing it forever.
            await removeQueuedCheckIn(entry.localId);
            setLog((prev) => [
              {
                id: entry.localId,
                pilgrimCode: entry.pilgrimCode,
                event: entry.event as CheckInEvent,
                status: 'failed',
                detail: err.message,
                at: Date.now(),
              },
              ...prev,
            ]);
          } else {
            // Still offline — stop here, leave the rest queued for next time.
            break;
          }
        }
      }
    } finally {
      await refreshPending();
      setSyncing(false);
    }
  }, [user, syncing, refreshPending]);

  // Reads the browser's own connectivity state into React state on mount,
  // then subscribes to its change events — the legitimate "sync from an
  // external system" case the set-state-in-effect rule's own description
  // calls out, not the derived-state anti-pattern it otherwise warns about.
  // `flushOutbox`/`goOnline`/`goOffline` are intentionally omitted from deps:
  // this should attach exactly one pair of listeners for the component's
  // lifetime, not re-subscribe every time the outbox callback is redefined.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => {
      setIsOnline(true);
      flushOutbox();
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Same "check on mount" idiom as AuthProvider's own effect — loads
  // whatever was queued on a previous visit and, if already online,
  // attempts to sync it immediately.
  useEffect(() => {
    refreshPending();
    if (navigator.onLine) flushOutbox();
  }, [user]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pilgrimCode.trim() || !user) return;
    setSubmitting(true);
    setError(null);
    const code = pilgrimCode.trim();
    const clientTimestamp = Date.now();

    try {
      await apiRequest('/hajj-ops/checkin/scan', {
        method: 'POST',
        body: { pilgrimCode: code, event, location: location || undefined },
      });
      setLog((prev) => [{ id: `${clientTimestamp}`, pilgrimCode: code, event, status: 'synced', at: clientTimestamp }, ...prev]);
      setPilgrimCode('');
      inputRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        // Not an HTTP error — treat as a connectivity failure and queue it.
        await queueCheckIn({ identityId: user.id, pilgrimCode: code, event, location: location || undefined, clientTimestamp });
        setLog((prev) => [{ id: `${clientTimestamp}`, pilgrimCode: code, event, status: 'queued', at: clientTimestamp }, ...prev]);
        setPilgrimCode('');
        inputRef.current?.focus();
        await refreshPending();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canCheckIn = user?.permissions.includes('hajj_ops:check_in') ?? false;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Field Check-In" navLinks={ADMIN_NAV}>
        {!canCheckIn ? (
          <p className="text-sm text-slate-500">You don&apos;t have permission to check pilgrims in.</p>
        ) : (
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Pilgrim Check-In</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Scan or type a pilgrim&apos;s QR code to check them in at a group, airport, transport, hotel, or
            departure event. Works without a connection — checks are queued and synced automatically.
          </p>

          {pending.length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>
                {pending.length} check-in{pending.length === 1 ? '' : 's'} waiting to sync
              </span>
              <button
                onClick={flushOutbox}
                disabled={syncing || !isOnline}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs text-slate-500">
              Pilgrim QR code
              <input
                ref={inputRef}
                autoFocus
                value={pilgrimCode}
                onChange={(e) => setPilgrimCode(e.target.value)}
                placeholder="PLG-XXXXXXXXXXXX"
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-xs text-slate-500">
              Event
              <select
                value={event}
                onChange={(e) => setEvent(e.target.value as CheckInEvent)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-500">
              Location (optional)
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Terminal 2, Gate B"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Checking in…' : 'Check in'}
            </button>
          </form>

          {log.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-700">This session</h3>
              <ul className="mt-2 space-y-1.5">
                {log.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-slate-700">{entry.pilgrimCode}</span>
                    <span className="text-slate-500">{entry.event.replace(/_/g, ' ')}</span>
                    <span
                      className={
                        entry.status === 'synced'
                          ? 'font-medium text-emerald-600'
                          : entry.status === 'queued'
                            ? 'font-medium text-amber-600'
                            : 'font-medium text-red-600'
                      }
                      title={entry.detail}
                    >
                      {entry.status === 'synced' ? 'Synced' : entry.status === 'queued' ? 'Queued' : 'Failed'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
