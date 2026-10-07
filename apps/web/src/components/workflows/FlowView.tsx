'use client';

import { motion } from 'framer-motion';
import type { GraphIssue, WfGraph } from '@/lib/workflow-types';
import { LABEL_TEXT, nodeSummary, orderedNodes, OUTPUTS, TYPE_META } from './graph-utils';

/**
 * A readable picture of the workflow: each step as a card in running order, with the
 * connections it offers shown as labelled chips ("if yes → Send email"). Steps with problems
 * are outlined, and a pulse marks the one being edited. No code or JSON is ever shown.
 */
export function FlowView({ graph, selected, onSelect, issues = [] }: { graph: WfGraph; selected?: string | null; onSelect?: (id: string) => void; issues?: GraphIssue[] }) {
  const nodes = orderedNodes(graph);
  const names = new Map(graph.nodes.map((n) => [n.id, n.name || TYPE_META[n.type].label]));
  const problems = new Map<string, number>();
  for (const i of issues) if (i.nodeId && i.level === 'error') problems.set(i.nodeId, (problems.get(i.nodeId) ?? 0) + 1);

  return (
    <ol className="relative space-y-0" aria-label="Workflow steps in running order">
      {nodes.map((n, index) => {
        const meta = TYPE_META[n.type];
        const rules = OUTPUTS[n.type];
        const labels = [...rules.required, ...rules.optional];
        const bad = problems.get(n.id);
        const active = selected === n.id;
        return (
          <li key={n.id} className="relative pb-3 pl-9">
            {/* the rail */}
            {index < nodes.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-slate-200" aria-hidden />}
            <span className={`absolute left-0 top-2 flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-bold ${meta.tone}`} aria-hidden>
              {index + 1}
            </span>
            <motion.button
              type="button"
              onClick={() => onSelect?.(n.id)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03 }}
              whileHover={{ y: -1 }}
              className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md ${active ? 'border-sky-400 ring-2 ring-sky-200' : bad ? 'border-rose-300' : 'border-slate-200'}`}
              aria-current={active ? 'step' : undefined}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.tone}`}>{meta.label}</span>
                  <span className="text-sm font-semibold text-slate-900">{n.name || meta.label}</span>
                </span>
                {bad ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">{bad} problem{bad > 1 ? 's' : ''}</span> : null}
              </div>
              {nodeSummary(n) && <p className="mt-1 break-words text-xs text-slate-500">{nodeSummary(n)}</p>}
              {labels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {labels.map((l) => {
                    const to = graph.edges.find((e) => e.from === n.id && (e.label ?? 'default') === l)?.to;
                    return (
                      <span key={l} className={`rounded-full px-2 py-0.5 text-[11px] ${to ? 'bg-slate-100 text-slate-700' : rules.required.includes(l) ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-400'}`}>
                        {LABEL_TEXT[l]} → {to ? names.get(to) ?? to : rules.required.includes(l) ? 'not connected' : '—'}
                      </span>
                    );
                  })}
                </div>
              )}
            </motion.button>
          </li>
        );
      })}
    </ol>
  );
}
