'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ExecutionTrace, StatusPill } from '@/components/workflows/ExecutionTrace';
import { FlowView } from '@/components/workflows/FlowView';
import { addNode, removeNode, TYPE_META } from '@/components/workflows/graph-utils';
import { StepForm } from '@/components/workflows/StepForm';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { errorText, useApi } from '@/lib/use-api';
import type { Catalog, ExecutionDetail, NodeType, Simulation, ValidationReport, WfGraph, WfNode, WorkflowDetail, WorkflowStatus } from '@/lib/workflow-types';

const STATUS_STYLE: Record<WorkflowStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  TESTING: 'bg-violet-100 text-violet-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PAUSED: 'bg-amber-100 text-amber-800',
  DISABLED: 'bg-slate-200 text-slate-600',
  ARCHIVED: 'bg-slate-100 text-slate-400',
};

const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40';
const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200';

/** A plausible sample event built from the fields the trigger provides, which the author can edit. */
function sampleFor(fields: string[]): string {
  const root: Record<string, Record<string, unknown>> = {};
  for (const f of fields) {
    if (f.includes('*') || f.startsWith('event.') || f.startsWith('steps')) continue;
    const [head, ...rest] = f.split('.');
    if (rest.length === 0) continue;
    const leaf = rest.join('.');
    root[head] = root[head] ?? {};
    root[head][leaf] = /amount|Amount/.test(leaf) ? 250000 : /At$|window/.test(leaf) ? '2026-12-01T08:00:00Z' : /currency/.test(leaf) ? 'NGN' : /status/.test(leaf) ? 'APPROVED' : /priority/.test(leaf) ? 'HIGH' : `sample-${leaf}`;
  }
  return JSON.stringify(root, null, 2);
}

/** What survives a reload of the workflow (the builder remounts on reload, so these would otherwise be lost). */
interface Carry {
  execution: ExecutionDetail | null;
  message: { tone: 'ok' | 'error'; text: string } | null;
}

function Builder({ detail, catalog, reload, carry, onCarry }: { detail: WorkflowDetail; catalog: Catalog; reload: () => void; carry: Carry | null; onCarry: (c: Carry | null) => void }) {
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const latest = detail.versions[0];
  const archived = detail.status === 'ARCHIVED';
  const canEdit = perms.includes('workflow:edit') && !archived;
  const canTest = perms.includes('workflow:test') && !archived;
  const canActivate = perms.includes('workflow:activate') && !archived;
  const canPause = perms.includes('workflow:pause');

  const [graph, setGraph] = useState<WfGraph>(latest.graph);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(latest.graph.nodes[0]?.id ?? null);
  const [report, setReport] = useState<ValidationReport | null>(latest.validation);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(carry?.message ?? null);
  const [newType, setNewType] = useState<NodeType>('ACTION');

  const trigger = graph.nodes.find((n) => n.type === 'TRIGGER');
  const tcfg = (trigger?.config ?? {}) as { event?: string; schedule?: unknown };
  const eventType = typeof tcfg.event === 'string' ? tcfg.event : tcfg.schedule ? `schedule.${detail.id}` : '';
  const serverFields = catalog.fieldsByTrigger[eventType] ?? (tcfg.schedule ? ['schedule.window', 'schedule.frequency'] : []);
  const vars = serverFields.filter((f) => !f.includes('*') && !f.startsWith('event.'));
  const [sample, setSample] = useState(() => sampleFor(vars));
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [execution, setExecution] = useState<ExecutionDetail | null>(carry?.execution ?? null);

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const lockedNote = latest.isLocked;

  const edit = (g: WfGraph) => {
    setGraph(g);
    setDirty(true);
    setSimulation(null);
    setExecution(null);
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };
  const parsedSample = (): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(sample) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const save = () =>
    run('save', async () => {
      const res = await apiRequest<{ version: number; createdNewVersion: boolean; validation: ValidationReport }>(`/workflows/${detail.id}/versions`, { method: 'PUT', body: { graph, ...(reason.trim() ? { changeReason: reason.trim() } : {}) } });
      setReport(res.validation);
      setDirty(false);
      setMessage({ tone: 'ok', text: res.createdNewVersion ? `Saved as version ${res.version}. The earlier version is unchanged.` : 'Draft saved.' });
      if (res.createdNewVersion) {
        onCarry({ execution: null, message: { tone: 'ok', text: `Saved as version ${res.version}. The earlier version is unchanged.` } });
        reload();
      }
    });

  const showWhyNot = async () => {
    try {
      const v = await apiRequest<ValidationReport & { version: number }>(`/workflows/${detail.id}/validate`);
      setReport(v);
    } catch {
      /* the error message is already shown */
    }
  };

  const dryRun = () =>
    run('dry', async () => {
      const payload = parsedSample();
      if (!payload) throw new Error('The sample data is not valid JSON.');
      if (dirty) throw new Error('Save your changes first — a dry run uses the saved workflow.');
      const res = await apiRequest<{ validation: ValidationReport; simulation: Simulation | null }>(`/workflows/${detail.id}/dry-run`, { method: 'POST', body: { payload } });
      setReport(res.validation);
      setSimulation(res.simulation);
      setExecution(null);
      if (!res.simulation) setMessage({ tone: 'error', text: 'The workflow has problems, so it cannot be simulated yet — see the list below.' });
    });

  const test = () =>
    run('test', async () => {
      const payload = parsedSample();
      if (!payload) throw new Error('The sample data is not valid JSON.');
      if (dirty) throw new Error('Save your changes first — a test runs the saved workflow.');
      const res = await apiRequest<{ started: boolean; reason?: string; execution?: ExecutionDetail }>(`/workflows/${detail.id}/test`, { method: 'POST', body: { payload } });
      setSimulation(null);
      if (!res.started) setMessage({ tone: 'ok', text: res.reason ?? 'The test did not start.' });
      else {
        onCarry({ execution: res.execution ?? null, message: { tone: 'ok', text: 'Test finished. Every action was a mock: nothing was sent, created or charged. Testing locks this version.' } });
        reload();
      }
    });

  const activate = () =>
    run('activate', async () => {
      if (dirty) throw new Error('Save your changes before activating.');
      try {
        await apiRequest(`/workflows/${detail.id}/activate`, { method: 'POST', body: {} });
      } catch (err) {
        await showWhyNot();
        throw err;
      }
      onCarry({ execution: null, message: { tone: 'ok', text: 'Activated. It now reacts to new events (it does not re-run past ones).' } });
      reload();
    });

  const change = (path: 'pause' | 'resume' | 'disable' | 'archive') =>
    run(path, async () => {
      const needsReason = path !== 'resume';
      const why = needsReason ? window.prompt(`Why are you ${path === 'pause' ? 'pausing' : path === 'disable' ? 'disabling' : 'archiving'} this workflow?`) : null;
      if (needsReason && (!why || why.trim().length < 5)) throw new Error('A reason of at least 5 characters is needed.');
      await apiRequest(`/workflows/${detail.id}/${path}`, { method: 'POST', body: needsReason ? { reason: why?.trim() } : {} });
      onCarry({ execution: null, message: { tone: 'ok', text: `Workflow ${path === 'resume' ? 'resumed' : path === 'pause' ? 'paused' : path === 'disable' ? 'disabled' : 'archived'}.` } });
      reload();
    });

  const errors = report?.errors ?? [];
  const warnings = report?.warnings ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/workflows" className="text-xs text-sky-700 hover:underline">← All workflows</Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
            {detail.name} <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[detail.status]}`}>{detail.status}</span>
            {detail.isDemo && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">DEMO</span>}
          </h2>
          {detail.description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{detail.description}</p>}
          <p className="mt-1 text-xs text-slate-500">Editing version {latest.version}{lockedNote ? ' (locked — saving creates the next version)' : ' (draft)'} · {detail.triggerEvent ? `listening for ${detail.triggerEvent}` : 'not active'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <button type="button" disabled={!dirty || busy !== null} onClick={save} className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}>{busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>}
          {canTest && <button type="button" disabled={busy !== null} onClick={dryRun} className={`${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>{busy === 'dry' ? 'Simulating…' : 'Dry run'}</button>}
          {canTest && <button type="button" disabled={busy !== null} onClick={test} className={`${btn} border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100`}>{busy === 'test' ? 'Testing…' : 'Test (mock actions)'}</button>}
          {canActivate && (detail.status === 'PAUSED' || detail.status === 'DISABLED') && <button type="button" disabled={busy !== null} onClick={() => change('resume')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Resume</button>}
          {canActivate && detail.status !== 'PAUSED' && detail.status !== 'DISABLED' && <button type="button" disabled={busy !== null || dirty || errors.length > 0} onClick={activate} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} title={errors.length > 0 ? 'Fix the problems first' : undefined}>{detail.status === 'ACTIVE' ? 'Activate this version' : 'Activate'}</button>}
          {canPause && detail.status === 'ACTIVE' && <button type="button" disabled={busy !== null} onClick={() => change('pause')} className={`${btn} border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}>Pause</button>}
          {canPause && (detail.status === 'ACTIVE' || detail.status === 'PAUSED') && <button type="button" disabled={busy !== null} onClick={() => change('disable')} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Disable</button>}
          {canPause && detail.status !== 'ACTIVE' && !archived && <button type="button" disabled={busy !== null} onClick={() => change('archive')} className={`${btn} text-rose-700 hover:bg-rose-50`}>Archive</button>}
        </div>
      </div>

      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-sm ${message.tone === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>}
      {lockedNote && canEdit && (
        <label className="mb-3 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
          This version has been tested or activated, so it cannot change. Describe your change — saving creates version {latest.version + 1} and any run already in progress keeps using the old one.
          <input className={field} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why are you changing this workflow?" />
        </label>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" role="region" aria-label="Validation">
          <p className="text-sm font-semibold text-slate-900">{errors.length > 0 ? `${errors.length} problem${errors.length > 1 ? 's' : ''} to fix before this can be activated` : 'No blocking problems'}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {errors.map((e, i) => <li key={`e${i}`} className="flex gap-2 text-rose-800"><span aria-hidden>✕</span><button type="button" className="text-left hover:underline" onClick={() => e.nodeId && setSelected(e.nodeId)}>{e.message}</button></li>)}
            {warnings.map((w, i) => <li key={`w${i}`} className="flex gap-2 text-amber-800"><span aria-hidden>!</span>{w.message}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            {canEdit && (
              <>
                <label className="text-xs font-medium text-slate-600">Add a step
                  <select className={field} value={newType} onChange={(e) => setNewType(e.target.value as NodeType)}>
                    {(['ACTION', 'CONDITION', 'APPROVAL', 'DELAY', 'WAIT', 'ESCALATION', 'END'] as NodeType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label} — {TYPE_META[t].hint}</option>)}
                  </select>
                </label>
                <button type="button" className={`${btn} border border-slate-300 bg-white hover:bg-slate-50`} onClick={() => { const r = addNode(graph, newType); edit(r.graph); setSelected(r.id); }}>Add</button>
              </>
            )}
          </div>
          <FlowView graph={graph} selected={selected} onSelect={setSelected} issues={errors} />
        </div>
        <div>
          {selectedNode ? (
            <StepForm
              key={selectedNode.id}
              node={selectedNode}
              graph={graph}
              catalog={catalog}
              vars={vars}
              disabled={!canEdit}
              onNode={(n: WfNode) => edit({ ...graph, nodes: graph.nodes.map((x) => (x.id === n.id ? n : x)) })}
              onGraph={edit}
              onDelete={() => { edit(removeNode(graph, selectedNode.id)); setSelected(graph.nodes[0]?.id ?? null); }}
            />
          ) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Select a step to edit it.</p>}
        </div>
      </div>

      {(canTest) && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Try it with sample data</h3>
          <p className="mt-1 text-xs text-slate-500">Dry run shows what would happen without running anything. Test runs the real engine with mock actions — no message is sent, no task is created, no money moves.</p>
          <label className="mt-2 block text-xs font-medium text-slate-600">Sample event data (JSON)
            <textarea className={`${field} font-mono text-xs`} rows={8} value={sample} onChange={(e) => setSample(e.target.value)} spellCheck={false} />
          </label>
        </section>
      )}

      {simulation && (
        <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Dry run — {simulation.completed ? 'reaches the end' : 'stops early'}</h3>
          {simulation.stoppedBecause && <p className="mt-1 text-xs text-amber-800">{simulation.stoppedBecause}</p>}
          <ol className="mt-2 space-y-1 text-xs">{simulation.steps.map((s) => <li key={s.nodeId} className="flex gap-2"><span className="font-mono text-slate-500">{s.nodeId}</span><span className="text-slate-800">{s.outcome}</span></li>)}</ol>
          {simulation.wouldRun.length > 0 && <p className="mt-2 text-xs text-slate-700">Would run: {simulation.wouldRun.map((w) => `${w.label}${w.sideEffect === 'NOTIFY' ? ' (sends a message)' : ''}`).join(' → ')}</p>}
          {simulation.warnings.map((w) => <p key={w} className="mt-1 text-xs text-amber-800">⚠ {w}</p>)}
        </section>
      )}

      {execution && (
        <section className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">Test run <StatusPill status={execution.status} /></h3>
          <div className="mt-3"><ExecutionTrace execution={execution} /></div>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Version history</h3>
        <ul className="mt-2 divide-y divide-slate-100 text-xs">
          {detail.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-semibold">Version {v.version}</span>{v.id === detail.activeVersionId && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">ACTIVE</span>}{v.isLocked ? <span className="ml-2 text-slate-400">locked</span> : <span className="ml-2 text-slate-400">draft</span>}</span>
              <span className="text-slate-500">{v.changeReason ?? '—'} · {formatDateTime(v.createdAt)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-400">A run always finishes on the version it started with, so changing or activating a newer version never alters one already in progress.</p>
      </section>
    </>
  );
}

export default function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const [rev, setRev] = useState(0);
  const [carry, setCarry] = useState<Carry | null>(null);
  const detail = useApi<WorkflowDetail>(`/workflows/${id}`, rev);
  const catalog = useApi<Catalog>('/automation/catalog');

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="Workflow builder" navLinks={ADMIN_NAV}>
        {(detail.loading || catalog.loading) && <div className="h-48 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />}
        {(detail.error || catalog.error) && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{detail.error ?? catalog.error}</p>}
        {detail.data && catalog.data && <Builder key={`${detail.data.id}-${detail.data.latestVersion}-${detail.data.status}-${rev}`} detail={detail.data} catalog={catalog.data} reload={() => setRev((n) => n + 1)} carry={carry} onCarry={setCarry} />}
      </AppShell>
    </ProtectedRoute>
  );
}
