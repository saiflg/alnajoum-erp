'use client';

import { formatDateTime } from '@/lib/format';
import type { ExecutionDetail, ExecutionStatus, StepRow } from '@/lib/workflow-types';
import { TYPE_META } from './graph-utils';

export const STATUS_STYLE: Record<ExecutionStatus | StepRow['status'], string> = {
  RUNNING: 'bg-sky-100 text-sky-800',
  WAITING: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  SUCCEEDED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
  DEAD_LETTERED: 'bg-rose-100 text-rose-800',
  SKIPPED: 'bg-slate-100 text-slate-600',
  RETRYING: 'bg-amber-100 text-amber-800',
};

export function StatusPill({ status }: { status: keyof typeof STATUS_STYLE }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>{status.replace('_', ' ')}</span>;
}

const pretty = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/** Every step of an execution: what ran, with what result, how many attempts, and why a condition went the way it did. */
export function ExecutionTrace({ execution }: { execution: ExecutionDetail }) {
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Workflow</dt><dd className="font-medium text-slate-900">{execution.workflow.name} <span className="text-slate-400">v{execution.versionNo}</span></dd></div>
        <div><dt className="text-slate-500">Mode</dt><dd className="font-medium">{execution.mode === 'TEST' ? 'Test (nothing real was done)' : 'Live'}</dd></div>
        <div><dt className="text-slate-500">Started</dt><dd>{formatDateTime(execution.startedAt)}</dd></div>
        <div><dt className="text-slate-500">Finished</dt><dd>{execution.finishedAt ? formatDateTime(execution.finishedAt) : '—'}</dd></div>
        <div><dt className="text-slate-500">Trigger</dt><dd>{execution.event ? `${execution.event.type} (${execution.event.source})` : 'Test sample'}</dd></div>
        <div><dt className="text-slate-500">Record</dt><dd className="break-all font-mono">{execution.entityType ? `${execution.entityType} ${execution.entityId ?? ''}` : '—'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-500">Correlation id (links every system this touched)</dt><dd className="break-all font-mono">{execution.correlationId}</dd></div>
      </dl>
      {execution.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{execution.error}</p>}
      {execution.waitingFor && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Waiting: {pretty(execution.waitingFor)}{execution.nextRunAt ? ` — next check ${formatDateTime(execution.nextRunAt)}` : ''}</p>}

      <ol className="space-y-2">
        {execution.steps.map((s) => (
          <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TYPE_META[s.nodeType].tone}`}>{TYPE_META[s.nodeType].label}</span>
                {s.nodeId}
              </span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {s.mocked && <span className="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-700">mock</span>}
                {s.attempts > 1 && <span>{s.attempts} attempts</span>}
                <StatusPill status={s.status} />
              </span>
            </div>
            {s.error && <p className="mt-1 text-xs text-rose-700">{s.error}</p>}
            {s.trace && s.trace.length > 0 && (
              <table className="mt-2 w-full text-left text-[11px]">
                <thead className="text-slate-500"><tr><th className="py-0.5 pr-2">Rule</th><th className="pr-2">Found</th><th className="pr-2">Wanted</th><th>Result</th></tr></thead>
                <tbody>{s.trace.map((t) => <tr key={t.path} className="border-t border-slate-100"><td className="py-0.5 pr-2 font-mono">{t.field} {t.op}</td><td className="pr-2 font-mono">{pretty(t.actual)}</td><td className="pr-2 font-mono">{pretty(t.expected)}</td><td className={t.result ? 'text-emerald-700' : 'text-rose-700'}>{t.result ? 'true' : 'false'}{t.note ? ` (${t.note})` : ''}</td></tr>)}</tbody>
              </table>
            )}
            {(s.output !== null && s.output !== undefined) && (
              <details className="mt-1"><summary className="cursor-pointer text-[11px] text-slate-500">Result</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{pretty(s.output)}</pre></details>
            )}
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400" title="Passed to the action so a retry can never do the same thing twice">{s.idempotencyKey}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
