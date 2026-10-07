import { WorkflowGraph } from './graph';
import { simulateWorkflow } from './simulate';

const actions = new Map([
  ['notify.email', { label: 'Send email', sideEffect: 'NOTIFY' as const }],
  ['task.create', { label: 'Create task', sideEffect: 'NONE' as const }],
]);

const graph: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'TRIGGER', config: { event: 'booking.cancelled' } },
    {
      id: 'big',
      type: 'CONDITION',
      config: {
        condition: { field: 'booking.totalAmount', op: 'gte', value: 500000 },
      },
    },
    {
      id: 'mail',
      type: 'ACTION',
      config: {
        action: 'notify.email',
        subject: 'Cancelled {{booking.reference}}',
        body: 'Hi {{customer.name}}, your {{booking.product}} is cancelled.',
      },
    },
    {
      id: 'review',
      type: 'APPROVAL',
      config: { approvalType: 'REFUND_REVIEW', timeoutMs: 86_400_000 },
    },
    {
      id: 'task',
      type: 'ACTION',
      config: {
        action: 'task.create',
        title: 'Process refund {{booking.reference}}',
      },
    },
    { id: 'pause', type: 'DELAY', config: { durationMs: 3_600_000 } },
    { id: 'done', type: 'END' },
    { id: 'rejected', type: 'END' },
  ],
  edges: [
    { from: 'start', to: 'big' },
    { from: 'big', to: 'mail', label: 'true' },
    { from: 'big', to: 'done', label: 'false' },
    { from: 'mail', to: 'review' },
    { from: 'review', to: 'pause', label: 'approved' },
    { from: 'review', to: 'rejected', label: 'rejected' },
    { from: 'pause', to: 'task' },
    { from: 'task', to: 'done' },
  ],
};
const sample = {
  booking: { totalAmount: 750_000, reference: 'ANJ-9', product: 'flight' },
  customer: { name: 'Amina' },
};

describe('simulateWorkflow', () => {
  it('walks the true branch and lists every action that would run, in order', () => {
    const r = simulateWorkflow(graph, sample, { actions });
    expect(r.completed).toBe(true);
    expect(r.steps.map((s) => s.nodeId)).toEqual([
      'start',
      'big',
      'mail',
      'review',
      'pause',
      'task',
      'done',
    ]);
    expect(r.wouldRun.map((w) => w.action)).toEqual([
      'notify.email',
      'task.create',
    ]);
    expect(r.wouldRun[0].sideEffect).toBe('NOTIFY');
    expect(r.warnings).toEqual([]);
  });
  it('takes the false branch for a small booking and runs nothing', () => {
    const r = simulateWorkflow(
      graph,
      { ...sample, booking: { ...sample.booking, totalAmount: 1000 } },
      { actions },
    );
    expect(r.steps.map((s) => s.nodeId)).toEqual(['start', 'big', 'done']);
    expect(r.wouldRun).toEqual([]);
  });
  it('follows the rejected approval path when asked', () => {
    const r = simulateWorkflow(graph, sample, {
      actions,
      assumeApproval: 'rejected',
    });
    expect(r.steps.map((s) => s.nodeId)).toEqual([
      'start',
      'big',
      'mail',
      'review',
      'rejected',
    ]);
    expect(r.wouldRun.map((w) => w.action)).toEqual(['notify.email']);
  });
  it('warns about template variables the event does not supply', () => {
    const r = simulateWorkflow(
      graph,
      { booking: { totalAmount: 750_000 } },
      { actions },
    );
    expect(r.warnings.join(' ')).toContain('{{booking.reference}}');
    expect(r.warnings.join(' ')).toContain('{{customer.name}}');
  });
  it('stops cleanly when the trigger condition is not met', () => {
    const g = JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
    g.nodes[0].config = {
      condition: { field: 'booking.status', op: 'eq', value: 'CANCELLED' },
    };
    const r = simulateWorkflow(g, sample, { actions });
    expect(r.completed).toBe(false);
    expect(r.stoppedBecause).toContain('trigger condition');
    expect(r.wouldRun).toEqual([]);
  });
  it('cannot loop forever on a malformed graph', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'TRIGGER' },
        { id: 'a', type: 'ACTION', config: { action: 'task.create' } },
      ],
      edges: [
        { from: 'start', to: 'a' },
        { from: 'a', to: 'a' },
      ],
    };
    const r = simulateWorkflow(g, {}, { actions });
    expect(r.stoppedBecause).toContain('reached twice');
  });
  it('reports a missing connection instead of guessing', () => {
    const g: WorkflowGraph = {
      nodes: [{ id: 'start', type: 'TRIGGER' }],
      edges: [],
    };
    expect(simulateWorkflow(g, {}, { actions }).stoppedBecause).toContain(
      'no "default" connection',
    );
  });
  it('has no side effects: the sample is not modified', () => {
    const copy = JSON.stringify(sample);
    simulateWorkflow(graph, sample, { actions });
    expect(JSON.stringify(sample)).toBe(copy);
  });
});
