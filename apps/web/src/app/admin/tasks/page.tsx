'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

type TaskRelatedType =
  | 'FOLLOW_UP'
  | 'VISA'
  | 'FLIGHT'
  | 'HOTEL'
  | 'HAJJ'
  | 'UMRAH'
  | 'PAYMENT'
  | 'CUSTOMER'
  | 'GUARANTOR'
  | 'DOCUMENT'
  | 'LEAD'
  | 'SUPPORT_TICKET'
  | 'OTHER';

interface Task {
  id: string;
  title: string;
  description: string | null;
  relatedType: TaskRelatedType;
  dueDate: string;
  priority: string;
  status: string;
  isAutoCreated: boolean;
}

interface MyTasks {
  today: Task[];
  upcoming: Task[];
  overdue: Task[];
  completed: Task[];
}

const RELATED_TYPES: TaskRelatedType[] = [
  'FOLLOW_UP',
  'VISA',
  'FLIGHT',
  'HOTEL',
  'HAJJ',
  'UMRAH',
  'PAYMENT',
  'CUSTOMER',
  'GUARANTOR',
  'DOCUMENT',
  'OTHER',
];

function TaskGroup({
  title,
  tasks,
  accent,
  onComplete,
  busyId,
}: {
  title: string;
  tasks: Task[];
  accent: string;
  onComplete: (id: string) => void;
  busyId: string | null;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className={`text-sm font-semibold ${accent}`}>
        {title} ({tasks.length})
      </h3>
      <div className="mt-2 space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div>
              <p className="font-medium text-slate-800">
                {t.title} {t.isAutoCreated && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">auto</span>}
              </p>
              {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
              <p className="mt-1 text-xs text-slate-400">
                {t.relatedType.replace('_', ' ')} · due {formatDateTime(t.dueDate)} · {t.priority}
              </p>
            </div>
            {t.status !== 'COMPLETED' && (
              <button disabled={busyId === t.id} onClick={() => onComplete(t.id)} className="text-emerald-600 hover:underline disabled:opacity-50">
                Complete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const myStaffId = (user?.profile as { id?: string } | null)?.id;
  const [tasks, setTasks] = useState<MyTasks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [relatedType, setRelatedType] = useState<TaskRelatedType>('FOLLOW_UP');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    apiRequest<MyTasks>('/crm/tasks/me')
      .then(setTasks)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load tasks'));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!myStaffId) {
      setError('Could not determine your staff profile — try reloading the page.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/crm/tasks', {
        method: 'POST',
        body: { title, relatedType, dueDate, notes: notes || undefined, assignedStaffId: myStaffId },
      });
      setTitle('');
      setNotes('');
      setDueDate('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  async function complete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/crm/tasks/${id}/status`, { method: 'POST', body: { status: 'COMPLETED' } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete this task');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="My Tasks" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">My Tasks</h2>
        <p className="mt-1 text-sm text-slate-500">
          Covers both follow-ups and every other task type — including ones the system created automatically (missing documents, overdue payments, unverified guarantors, approaching departures).
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-slate-500">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Type
            <select value={relatedType} onChange={(e) => setRelatedType(e.target.value as TaskRelatedType)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {RELATED_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Due date
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              Add task
            </button>
          </div>
        </form>

        {tasks && (
          <>
            <TaskGroup title="Overdue" tasks={tasks.overdue} accent="text-red-700" onComplete={complete} busyId={busyId} />
            <TaskGroup title="Today" tasks={tasks.today} accent="text-amber-700" onComplete={complete} busyId={busyId} />
            <TaskGroup title="Upcoming" tasks={tasks.upcoming} accent="text-slate-900" onComplete={complete} busyId={busyId} />
            <TaskGroup title="Completed" tasks={tasks.completed} accent="text-emerald-700" onComplete={complete} busyId={busyId} />
            {tasks.today.length === 0 && tasks.overdue.length === 0 && tasks.upcoming.length === 0 && tasks.completed.length === 0 && (
              <p className="mt-6 text-sm text-slate-500">No tasks assigned to you yet.</p>
            )}
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
