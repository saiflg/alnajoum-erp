'use client';

import { useState } from 'react';
import type { ActionInfoRow, Catalog, EdgeLabel, WfGraph, WfNode } from '@/lib/workflow-types';
import { humanDuration, LABEL_TEXT, nextOf, OUTPUTS, setNext, TYPE_META } from './graph-utils';

const input = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100 disabled:text-slate-500';
const label = 'block text-xs font-medium text-slate-600';

type Cfg = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** A copy of the config without the given keys. */
const omit = (o: Cfg, ...keys: string[]): Cfg => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const OPS: [string, string, 'one' | 'none' | 'list' | 'range'][] = [
  ['eq', 'is equal to', 'one'], ['neq', 'is not equal to', 'one'], ['gt', 'is greater than', 'one'], ['gte', 'is at least', 'one'],
  ['lt', 'is less than', 'one'], ['lte', 'is at most', 'one'], ['contains', 'contains', 'one'], ['startsWith', 'starts with', 'one'],
  ['endsWith', 'ends with', 'one'], ['in', 'is one of (comma separated)', 'list'], ['notIn', 'is not one of', 'list'],
  ['exists', 'has a value', 'none'], ['notExists', 'has no value', 'none'], ['dateBefore', 'is before date', 'one'],
  ['dateAfter', 'is after date', 'one'], ['dateBetween', 'is between dates', 'range'],
];
const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte']);

interface Row { field: string; op: string; value: unknown }

function toRows(c: unknown): Row[] | null {
  if (!c || typeof c !== 'object') return [];
  const o = c as Record<string, unknown>;
  if ('field' in o) return [{ field: str(o.field), op: str(o.op) || 'eq', value: o.value }];
  if ('all' in o && Array.isArray(o.all) && o.all.every((x) => x && typeof x === 'object' && 'field' in (x as object))) {
    return (o.all as Row[]).map((x) => ({ field: str(x.field), op: str(x.op) || 'eq', value: x.value }));
  }
  return null; // nested AND/OR/NOT: edited as advanced JSON
}
function fromRows(rows: Row[]): unknown {
  const leaves = rows.map((r) => ({ field: r.field, op: r.op, ...(['exists', 'notExists'].includes(r.op) ? {} : { value: r.value }) }));
  return leaves.length === 1 ? leaves[0] : { all: leaves };
}

/** Plain "field / operator / value" rows joined by AND. Anything more complex falls back to an advanced editor. */
export function ConditionEditor({ value, onChange, fields, disabled }: { value: unknown; onChange: (v: unknown) => void; fields: string[]; disabled?: boolean }) {
  const rows = toRows(value);
  const [advanced, setAdvanced] = useState(rows === null);
  const [json, setJson] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  if (advanced || rows === null) {
    return (
      <div>
        <label className={label}>
          Advanced condition (nested AND / OR / NOT)
          <textarea className={`${input} font-mono text-xs`} rows={8} value={json} disabled={disabled} onChange={(e) => {
            setJson(e.target.value);
            try { onChange(JSON.parse(e.target.value)); setJsonError(null); } catch { setJsonError('This is not valid JSON yet'); }
          }} />
        </label>
        {jsonError && <p className="mt-1 text-xs text-amber-700">{jsonError}</p>}
        <p className="mt-1 text-xs text-slate-500">Conditions are data only: groups <code>all</code>/<code>any</code>/<code>not</code> and <code>{'{field, op, value}'}</code>. The server checks them before the workflow can be activated.</p>
        {rows !== null && <button type="button" className="mt-2 text-xs font-medium text-sky-700 hover:underline" onClick={() => setAdvanced(false)}>Back to simple rows</button>}
      </div>
    );
  }

  const update = (i: number, patch: Partial<Row>) => onChange(fromRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const listId = 'cond-fields';
  return (
    <div className="space-y-2">
      <datalist id={listId}>{fields.map((f) => <option key={f} value={f} />)}</datalist>
      {rows.length === 0 && <p className="text-xs text-slate-500">No condition: this always applies.</p>}
      {rows.map((r, i) => {
        const kind = OPS.find((o) => o[0] === r.op)?.[2] ?? 'one';
        const range = (r.value ?? {}) as { from?: string; to?: string };
        return (
          <div key={i} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[1.4fr_1.2fr_1.4fr_auto]">
            <label className={label}>{i === 0 ? 'When' : 'and'}
              <input list={listId} className={input} value={r.field} disabled={disabled} placeholder="e.g. booking.totalAmount" onChange={(e) => update(i, { field: e.target.value })} />
            </label>
            <label className={label}>Operator
              <select className={input} value={r.op} disabled={disabled} onChange={(e) => update(i, { op: e.target.value, value: e.target.value === 'dateBetween' ? { from: '', to: '' } : ['in', 'notIn'].includes(e.target.value) ? [] : '' })}>
                {OPS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            {kind === 'none' ? <div /> : kind === 'range' ? (
              <div className="grid grid-cols-2 gap-1">
                <label className={label}>From<input type="date" className={input} disabled={disabled} value={str(range.from)} onChange={(e) => update(i, { value: { ...range, from: e.target.value } })} /></label>
                <label className={label}>To<input type="date" className={input} disabled={disabled} value={str(range.to)} onChange={(e) => update(i, { value: { ...range, to: e.target.value } })} /></label>
              </div>
            ) : kind === 'list' ? (
              <label className={label}>Values<input className={input} disabled={disabled} value={Array.isArray(r.value) ? (r.value as unknown[]).join(', ') : ''} onChange={(e) => update(i, { value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="HIGH, CRITICAL" /></label>
            ) : (
              <label className={label}>Value
                <input className={input} disabled={disabled} type={NUMERIC_OPS.has(r.op) ? 'number' : 'text'} value={typeof r.value === 'number' ? r.value : str(r.value)} onChange={(e) => update(i, { value: NUMERIC_OPS.has(r.op) ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} />
              </label>
            )}
            <button type="button" disabled={disabled} className="self-end rounded-lg px-2 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40" onClick={() => onChange(rows.length <= 1 ? undefined : fromRows(rows.filter((_, j) => j !== i)))} aria-label="Remove this rule">Remove</button>
          </div>
        );
      })}
      <div className="flex gap-3">
        <button type="button" disabled={disabled} className="text-xs font-medium text-sky-700 hover:underline disabled:opacity-40" onClick={() => onChange(fromRows([...rows, { field: '', op: 'eq', value: '' }]))}>+ Add a rule (must also be true)</button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setJson(JSON.stringify(value ?? {}, null, 2)); setAdvanced(true); }}>Advanced…</button>
      </div>
    </div>
  );
}

const LANGS: [string, string, 'ltr' | 'rtl'][] = [['en', 'English', 'ltr'], ['ha', 'Hausa', 'ltr'], ['ar', 'العربية', 'rtl']];

/** Message text per language. One language -> plain subject/body; more -> translations (the customer's language is chosen at send time). */
function MessageFields({ cfg, onChange, needSubject, vars, disabled }: { cfg: Cfg; onChange: (c: Cfg) => void; needSubject: boolean; vars: string[]; disabled?: boolean }) {
  const [lang, setLang] = useState('en');
  const tr = (cfg.translations as Record<string, { subject?: string; body?: string }> | undefined) ?? { en: { subject: str(cfg.subject), body: str(cfg.body) } };
  const cur = tr[lang] ?? {};
  const dir = LANGS.find((l) => l[0] === lang)?.[2] ?? 'ltr';

  const commit = (nextTr: Record<string, { subject?: string; body?: string }>) => {
    const kept = Object.fromEntries(Object.entries(nextTr).filter(([k, v]) => k === 'en' || str(v.body) || str(v.subject)));
    const rest = omit(cfg, 'translations', 'subject', 'body');
    if (Object.keys(kept).length <= 1) onChange({ ...rest, subject: kept.en?.subject ?? '', body: kept.en?.body ?? '' });
    else onChange({ ...rest, translations: kept });
  };
  const set = (field: 'subject' | 'body', v: string) => commit({ ...tr, [lang]: { ...cur, [field]: v } });

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Message language">
        {LANGS.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={lang === k} onClick={() => setLang(k)} className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${lang === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {t}{tr[k] && (str(tr[k].body) || str(tr[k].subject)) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      {lang !== 'en' && <p className="text-xs text-slate-500">Used when the customer&apos;s preferred language is {LANGS.find((l) => l[0] === lang)?.[1]}; otherwise the English text is sent.</p>}
      {needSubject && <label className={label}>Subject<input dir={dir} className={input} disabled={disabled} value={str(cur.subject)} onChange={(e) => set('subject', e.target.value)} /></label>}
      <label className={label}>Message<textarea dir={dir} className={input} rows={4} disabled={disabled} value={str(cur.body)} onChange={(e) => set('body', e.target.value)} /></label>
      {vars.length > 0 && (
        <p className="text-[11px] leading-relaxed text-slate-500">Variables you can use: {vars.slice(0, 14).map((v) => <button key={v} type="button" disabled={disabled} className="mx-0.5 rounded bg-slate-100 px-1 font-mono text-slate-700 hover:bg-sky-100" onClick={() => set('body', `${str(cur.body)}{{${v}}}`)}>{`{{${v}}}`}</button>)}</p>
      )}
    </div>
  );
}

const ROLES = ['BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF', 'AUDITOR', 'COMPANY_ADMIN'];
const TASK_TYPES = ['OTHER', 'FOLLOW_UP', 'PAYMENT', 'VISA', 'FLIGHT', 'HOTEL', 'HAJJ', 'UMRAH', 'DOCUMENT', 'LEAD', 'SUPPORT_TICKET', 'CUSTOMER'];

/** The fields for one action, by action key. Used for ACTION steps and for each escalation level. */
export function ActionFields({ action, cfg, onChange, vars, disabled }: { action: string; cfg: Cfg; onChange: (c: Cfg) => void; vars: string[]; disabled?: boolean }) {
  const set = (patch: Cfg) => onChange({ ...cfg, ...patch });
  const assign = (cfg.assignTo as { mode?: string; role?: string; staffId?: string } | undefined) ?? { mode: 'ROLE', role: 'BRANCH_MANAGER' };
  switch (action) {
    case 'task.create':
      return (
        <div className="space-y-2">
          <label className={label}>Task title<input className={input} disabled={disabled} value={str(cfg.title)} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className={label}>Details (optional)<textarea className={input} rows={2} disabled={disabled} value={str(cfg.description)} onChange={(e) => set({ description: e.target.value })} /></label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={label}>Priority<select className={input} disabled={disabled} value={str(cfg.priority) || 'NORMAL'} onChange={(e) => set({ priority: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className={label}>Due in (hours)<input type="number" min={1} className={input} disabled={disabled} value={num(cfg.dueInHours) || 24} onChange={(e) => set({ dueInHours: Number(e.target.value) })} /></label>
            <label className={label}>About<select className={input} disabled={disabled} value={str(cfg.relatedType) || 'OTHER'} onChange={(e) => set({ relatedType: e.target.value })}>{TASK_TYPES.map((p) => <option key={p}>{p}</option>)}</select></label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>Assign to
              <select className={input} disabled={disabled} value={assign.mode} onChange={(e) => set({ assignTo: e.target.value === 'ROLE' ? { mode: 'ROLE', role: 'BRANCH_MANAGER' } : e.target.value === 'STAFF' ? { mode: 'STAFF', staffId: '' } : { mode: 'CUSTOMER_OWNER' } })}>
                <option value="ROLE">A person with a role (this company{'’'}s)</option><option value="STAFF">A specific staff member</option><option value="CUSTOMER_OWNER">The customer{'’'}s own staff member</option>
              </select>
            </label>
            {assign.mode === 'ROLE' && <label className={label}>Role<select className={input} disabled={disabled} value={assign.role} onChange={(e) => set({ assignTo: { mode: 'ROLE', role: e.target.value } })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>}
            {assign.mode === 'STAFF' && <label className={label}>Staff id<input className={input} disabled={disabled} value={str(assign.staffId)} onChange={(e) => set({ assignTo: { mode: 'STAFF', staffId: e.target.value } })} /></label>}
          </div>
        </div>
      );
    case 'notify.email':
    case 'notify.push':
      return <MessageFields cfg={cfg} onChange={onChange} needSubject vars={vars} disabled={disabled} />;
    case 'notify.sms':
    case 'notify.whatsapp':
      return <MessageFields cfg={cfg} onChange={onChange} needSubject={false} vars={vars} disabled={disabled} />;
    case 'crm.timeline':
      return <label className={label}>Timeline entry<textarea className={input} rows={2} disabled={disabled} value={str(cfg.description)} onChange={(e) => set({ description: e.target.value })} /></label>;
    case 'audit.note':
      return <label className={label}>Audit note<textarea className={input} rows={2} disabled={disabled} value={str(cfg.note)} onChange={(e) => set({ note: e.target.value })} /></label>;
    case 'event.emit':
      return (
        <div className="space-y-2">
          <label className={label}>Event name (must start with custom.)<input className={input} disabled={disabled} value={str(cfg.type)} placeholder="custom.refund_review" onChange={(e) => set({ type: e.target.value })} /></label>
          <label className={label}>Data to pass on (context paths, comma separated)<input className={input} disabled={disabled} value={Array.isArray(cfg.copy) ? (cfg.copy as string[]).join(', ') : ''} placeholder="booking.reference, customer.id" onChange={(e) => set({ copy: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
        </div>
      );
    default:
      return <p className="text-xs text-slate-500">Choose an action.</p>;
  }
}

const HOURS = (ms: number): number => Math.round((ms / 3_600_000) * 100) / 100;

export function StepForm({ node, graph, catalog, vars, disabled, onNode, onGraph, onDelete }: {
  node: WfNode;
  graph: WfGraph;
  catalog: Catalog;
  vars: string[];
  disabled?: boolean;
  onNode: (n: WfNode) => void;
  onGraph: (g: WfGraph) => void;
  onDelete: () => void;
}) {
  const cfg: Cfg = node.config ?? {};
  const set = (patch: Cfg) => onNode({ ...node, config: { ...cfg, ...patch } });
  const meta = TYPE_META[node.type];
  const outs = OUTPUTS[node.type];
  const triggerMode = cfg.schedule ? 'schedule' : 'event';
  const sched = (cfg.schedule as { frequency?: string; hour?: number; minute?: number; dayOfWeek?: number; dayOfMonth?: number } | undefined) ?? { frequency: 'DAILY', hour: 9 };
  const levels = (cfg.steps as { afterMs: number; action: string; config?: Cfg }[] | undefined) ?? [];
  const eventOptions = [...catalog.triggers.map((t) => ({ v: t.type, l: `${t.label} (${t.type})` }))];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={`Edit step: ${node.name ?? meta.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.tone}`}>{meta.label}</span>
          <p className="mt-1 text-xs text-slate-500">{meta.hint}</p>
        </div>
        {node.type !== 'TRIGGER' && <button type="button" disabled={disabled} onClick={onDelete} className="rounded-lg px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40">Delete step</button>}
      </div>

      <label className={`${label} mt-3`}>Step name<input className={input} disabled={disabled} value={node.name ?? ''} onChange={(e) => onNode({ ...node, name: e.target.value })} /></label>

      <div className="mt-3 space-y-3">
        {node.type === 'TRIGGER' && (
          <>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Trigger type">
              {(['event', 'schedule'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={triggerMode === m} disabled={disabled} onClick={() => onNode({ ...node, config: m === 'event' ? { event: catalog.triggers[0]?.type, ...(cfg.condition ? { condition: cfg.condition } : {}) } : { schedule: { frequency: 'DAILY', hour: 9 } } })} className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${triggerMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {m === 'event' ? 'When something happens' : 'On a schedule'}
                </button>
              ))}
            </div>
            {triggerMode === 'event' ? (
              <>
                <label className={label}>Event
                  <select className={input} disabled={disabled} value={str(cfg.event)} onChange={(e) => set({ event: e.target.value })}>
                    {eventOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    {str(cfg.event).startsWith('custom.') && <option value={str(cfg.event)}>{str(cfg.event)}</option>}
                  </select>
                </label>
                <p className="text-xs text-slate-500">{catalog.triggers.find((t) => t.type === cfg.event)?.description}</p>
                <div><span className={label}>Only start when (optional)</span><div className="mt-1"><ConditionEditor value={cfg.condition} fields={vars} disabled={disabled} onChange={(v) => { const rest = omit(cfg, 'condition'); onNode({ ...node, config: v ? { ...rest, condition: v } : rest }); }} /></div></div>
              </>
            ) : (
              <div className="grid gap-2 sm:grid-cols-4">
                <label className={label}>Repeat<select className={input} disabled={disabled} value={sched.frequency} onChange={(e) => set({ schedule: { frequency: e.target.value, ...(e.target.value === 'WEEKLY' ? { dayOfWeek: 1 } : {}), ...(e.target.value === 'MONTHLY' ? { dayOfMonth: 1 } : {}), ...(e.target.value === 'HOURLY' ? { minute: 0 } : { hour: 9 }) } })}>{['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'].map((f) => <option key={f}>{f}</option>)}</select></label>
                {sched.frequency === 'WEEKLY' && <label className={label}>Day<select className={input} disabled={disabled} value={sched.dayOfWeek} onChange={(e) => set({ schedule: { ...sched, dayOfWeek: Number(e.target.value) } })}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>}
                {sched.frequency === 'MONTHLY' && <label className={label}>Day of month<input type="number" min={1} max={28} className={input} disabled={disabled} value={sched.dayOfMonth ?? 1} onChange={(e) => set({ schedule: { ...sched, dayOfMonth: Number(e.target.value) } })} /></label>}
                {sched.frequency !== 'HOURLY' && <label className={label}>Hour (0–23)<input type="number" min={0} max={23} className={input} disabled={disabled} value={sched.hour ?? 0} onChange={(e) => set({ schedule: { ...sched, hour: Number(e.target.value) } })} /></label>}
                <label className={label}>Minute<input type="number" min={0} max={59} className={input} disabled={disabled} value={sched.minute ?? 0} onChange={(e) => set({ schedule: { ...sched, minute: Number(e.target.value) } })} /></label>
                <p className="text-xs text-slate-500 sm:col-span-4">Times are Lagos time. Each window runs once, even if several servers are running.</p>
              </div>
            )}
          </>
        )}

        {node.type === 'CONDITION' && <ConditionEditor value={cfg.condition} fields={vars} disabled={disabled} onChange={(v) => set({ condition: v ?? { field: '', op: 'eq', value: '' } })} />}

        {node.type === 'ACTION' && (
          <>
            <label className={label}>What to do
              <select className={input} disabled={disabled} value={str(cfg.action)} onChange={(e) => onNode({ ...node, config: { action: e.target.value } })}>
                {catalog.actions.map((a: ActionInfoRow) => <option key={a.key} value={a.key}>{a.label} ({a.key})</option>)}
              </select>
            </label>
            {catalog.actions.find((a) => a.key === cfg.action)?.sideEffect === 'NOTIFY' && <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">This sends a message to a customer. In test mode and dry run nothing is sent. Messages respect each customer&apos;s notification preferences and opt-outs.</p>}
            <ActionFields action={str(cfg.action)} cfg={cfg} vars={vars} disabled={disabled} onChange={(c) => onNode({ ...node, config: c })} />
          </>
        )}

        {node.type === 'APPROVAL' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>What is being approved<input className={input} disabled={disabled} value={str(cfg.approvalType)} onChange={(e) => set({ approvalType: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} /></label>
            <label className={label}>Give up after (hours)<input type="number" min={1} className={input} disabled={disabled} value={HOURS(num(cfg.timeoutMs))} onChange={(e) => set({ timeoutMs: Math.round(Number(e.target.value) * 3_600_000) })} /></label>
            <label className={label}>Amount field (optional)<input list="appr-fields" className={input} disabled={disabled} value={str(cfg.amountField)} onChange={(e) => { const rest = omit(cfg, 'amountField'); onNode({ ...node, config: e.target.value ? { ...rest, amountField: e.target.value } : rest }); }} /></label>
            <datalist id="appr-fields">{vars.map((v) => <option key={v} value={v} />)}</datalist>
            <p className="text-xs text-slate-500 sm:col-span-2">A real approval request goes through the existing approval engine and needs the usual number of approvers. The workflow owner cannot approve their own request.</p>
          </div>
        )}

        {node.type === 'DELAY' && (
          <label className={label}>Wait for (hours)<input type="number" min={0.01} step="any" className={input} disabled={disabled} value={HOURS(num(cfg.durationMs))} onChange={(e) => set({ durationMs: Math.max(60_000, Math.round(Number(e.target.value) * 3_600_000)) })} />
            <span className="mt-1 block text-xs text-slate-500">= {humanDuration(num(cfg.durationMs))}. Skipped in test mode.</span>
          </label>
        )}

        {node.type === 'WAIT' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>Wait until this happens
              <select className={input} disabled={disabled} value={str(cfg.until)} onChange={(e) => set({ until: e.target.value })}>{eventOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
            </label>
            <label className={label}>Give up after (hours)<input type="number" min={1} className={input} disabled={disabled} value={HOURS(num(cfg.timeoutMs))} onChange={(e) => set({ timeoutMs: Math.round(Number(e.target.value) * 3_600_000) })} /></label>
            <p className="text-xs text-slate-500 sm:col-span-2">It resumes only for an event about the same record. If nothing arrives in time, it follows the “if it times out” connection, or the run goes to the failure queue.</p>
          </div>
        )}

        {node.type === 'ESCALATION' && (
          <div className="space-y-3">
            <label className={label}>Stop escalating early when this happens (optional)
              <select className={input} disabled={disabled} value={str(cfg.stopOnEvent)} onChange={(e) => { const rest = omit(cfg, 'stopOnEvent'); onNode({ ...node, config: e.target.value ? { ...rest, stopOnEvent: e.target.value } : rest }); }}>
                <option value="">Never — always run every level</option>
                {eventOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </label>
            {levels.map((lv, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className={label}>Level {i + 1}: after (hours)<input type="number" min={0.01} step="any" className={input} disabled={disabled} value={HOURS(lv.afterMs)} onChange={(e) => set({ steps: levels.map((x, j) => (j === i ? { ...x, afterMs: Math.round(Number(e.target.value) * 3_600_000) } : x)) })} /></label>
                  <label className={label}>Then<select className={input} disabled={disabled} value={lv.action} onChange={(e) => set({ steps: levels.map((x, j) => (j === i ? { ...x, action: e.target.value, config: {} } : x)) })}>{catalog.actions.filter((a) => a.key !== 'event.emit').map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
                  <button type="button" disabled={disabled || levels.length <= 1} className="rounded-lg px-2 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-40" onClick={() => set({ steps: levels.filter((_, j) => j !== i) })}>Remove level</button>
                </div>
                <div className="mt-2"><ActionFields action={lv.action} cfg={lv.config ?? {}} vars={vars} disabled={disabled} onChange={(c) => set({ steps: levels.map((x, j) => (j === i ? { ...x, config: c } : x)) })} /></div>
              </div>
            ))}
            <button type="button" disabled={disabled} className="text-xs font-medium text-sky-700 hover:underline disabled:opacity-40" onClick={() => set({ steps: [...levels, { afterMs: (levels[levels.length - 1]?.afterMs ?? 0) + 3_600_000, action: 'task.create', config: { title: '', assignTo: { mode: 'ROLE', role: 'BRANCH_MANAGER' } } }] })}>+ Add another level</button>
          </div>
        )}
      </div>

      {[...outs.required, ...outs.optional].length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What happens next</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[...outs.required, ...outs.optional].map((l: EdgeLabel) => (
              <label key={l} className={label}>{LABEL_TEXT[l]}{outs.optional.includes(l) ? ' (optional)' : ''}
                <select className={input} disabled={disabled} value={nextOf(graph, node.id, l)} onChange={(e) => onGraph(setNext(graph, node.id, l, e.target.value))}>
                  <option value="">{outs.required.includes(l) ? '— choose a step —' : '— none —'}</option>
                  {graph.nodes.filter((n) => n.id !== node.id && n.type !== 'TRIGGER').map((n) => <option key={n.id} value={n.id}>{n.name || TYPE_META[n.type].label} ({n.id})</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
