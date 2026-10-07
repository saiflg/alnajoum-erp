import {
  GraphIssue,
  hasErrors,
  nextNode,
  validateGraph,
  WorkflowGraph,
} from './graph';

const good = (): WorkflowGraph => ({
  nodes: [
    { id: 'start', type: 'TRIGGER', config: { event: 'booking.confirmed' } },
    {
      id: 'big',
      type: 'CONDITION',
      config: {
        condition: { field: 'booking.totalAmount', op: 'gte', value: 500000 },
      },
    },
    { id: 'mail', type: 'ACTION', config: { action: 'notify.email' } },
    {
      id: 'approve',
      type: 'APPROVAL',
      config: { approvalType: 'FINANCE_REVIEW', timeoutMs: 86_400_000 },
    },
    { id: 'wait', type: 'DELAY', config: { durationMs: 3_600_000 } },
    { id: 'done', type: 'END' },
    { id: 'stop', type: 'END' },
  ],
  edges: [
    { from: 'start', to: 'big' },
    { from: 'big', to: 'mail', label: 'true' },
    { from: 'big', to: 'done', label: 'false' },
    { from: 'mail', to: 'approve' },
    { from: 'approve', to: 'wait', label: 'approved' },
    { from: 'approve', to: 'stop', label: 'rejected' },
    { from: 'wait', to: 'done' },
  ],
});
const codes = (issues: GraphIssue[]) => issues.map((i) => i.code);
const mutate = (fn: (g: WorkflowGraph) => void): GraphIssue[] => {
  const g = good();
  fn(g);
  return validateGraph(g);
};

describe('validateGraph', () => {
  it('accepts a well-formed workflow', () => {
    expect(validateGraph(good())).toEqual([]);
  });
  it('rejects non-graphs and empty graphs', () => {
    expect(codes(validateGraph(null))).toEqual(['MALFORMED']);
    expect(codes(validateGraph({ nodes: [], edges: [] }))).toEqual(['EMPTY']);
  });
  it('requires exactly one trigger and at least one End', () => {
    expect(
      codes(mutate((g) => (g.nodes = g.nodes.filter((n) => n.id !== 'start')))),
    ).toContain('NO_TRIGGER');
    expect(
      codes(mutate((g) => g.nodes.push({ id: 't2', type: 'TRIGGER' }))),
    ).toContain('MULTIPLE_TRIGGERS');
    expect(
      codes(
        validateGraph({ nodes: [{ id: 'start', type: 'TRIGGER' }], edges: [] }),
      ),
    ).toContain('NO_END');
  });
  it('finds unreachable steps', () => {
    const issues = mutate((g) => g.nodes.push({ id: 'island', type: 'END' }));
    expect(issues.find((i) => i.code === 'UNREACHABLE')?.nodeId).toBe('island');
  });
  it('finds cycles and names the loop', () => {
    const issues = mutate((g) => g.edges.push({ from: 'wait', to: 'mail' }));
    // wait already has a default edge, so this is a duplicate branch AND a cycle
    expect(codes(issues)).toContain('CYCLE');
    const cyc = issues.find((i) => i.code === 'CYCLE');
    expect(cyc?.message).toContain('mail');
  });
  it('rejects a step that connects to itself', () => {
    expect(
      codes(mutate((g) => g.edges.push({ from: 'mail', to: 'mail' }))),
    ).toContain('SELF_LOOP');
  });
  it('rejects dangling connections and duplicate ids', () => {
    expect(
      codes(mutate((g) => g.edges.push({ from: 'mail', to: 'ghost' }))),
    ).toContain('DANGLING_EDGE');
    expect(
      codes(mutate((g) => g.nodes.push({ id: 'mail', type: 'END' }))),
    ).toContain('DUPLICATE_ID');
  });
  it('rejects dead ends (a non-End step with no way out)', () => {
    const issues = mutate(
      (g) => (g.edges = g.edges.filter((e) => !(e.from === 'mail'))),
    );
    expect(codes(issues)).toContain('DEAD_END');
  });
  it('a condition needs both branches; an approval needs approved and rejected', () => {
    expect(
      codes(
        mutate(
          (g) =>
            (g.edges = g.edges.filter(
              (e) => !(e.from === 'big' && e.label === 'false'),
            )),
        ),
      ),
    ).toContain('MISSING_BRANCH');
    expect(
      codes(
        mutate(
          (g) =>
            (g.edges = g.edges.filter(
              (e) => !(e.from === 'approve' && e.label === 'rejected'),
            )),
        ),
      ),
    ).toContain('MISSING_BRANCH');
  });
  it('rejects labels a step type cannot have', () => {
    expect(
      codes(
        mutate((g) =>
          g.edges.push({ from: 'mail', to: 'done', label: 'approved' }),
        ),
      ),
    ).toContain('UNEXPECTED_BRANCH');
  });
  it('nothing may lead into the trigger, and End leads nowhere', () => {
    expect(
      codes(mutate((g) => g.edges.push({ from: 'mail', to: 'start' }))),
    ).toContain('TRIGGER_HAS_INCOMING');
    expect(
      codes(mutate((g) => g.edges.push({ from: 'done', to: 'mail' }))),
    ).toContain('END_HAS_OUTGOING');
  });
  it('validates conditions, including against the fields the trigger provides', () => {
    expect(
      codes(
        mutate(
          (g) =>
            (g.nodes[1].config = { condition: { field: 'a', op: 'matches' } }),
        ),
      ),
    ).toContain('INVALID_CONDITION');
    const g = good();
    const issues = validateGraph(g, {
      allowedFields: new Set(['customer.name']),
    });
    expect(
      issues.find((i) => i.code === 'INVALID_CONDITION')?.message,
    ).toContain('not available');
  });
  it('only allows actions the engine can run', () => {
    expect(
      codes(validateGraph(good(), { knownActions: new Set(['notify.sms']) })),
    ).toContain('UNKNOWN_ACTION');
    expect(
      validateGraph(good(), { knownActions: new Set(['notify.email']) }),
    ).toEqual([]);
    expect(codes(mutate((g) => (g.nodes[2].config = {})))).toContain(
      'MISSING_ACTION',
    );
  });
  it('requires sane timeouts so nothing waits forever', () => {
    expect(
      codes(mutate((g) => (g.nodes[4].config = { durationMs: -5 }))),
    ).toContain('INVALID_TIMEOUT');
    expect(
      codes(mutate((g) => (g.nodes[4].config = { durationMs: 1.5 }))),
    ).toContain('INVALID_TIMEOUT');
    expect(
      codes(
        mutate((g) => (g.nodes[4].config = { durationMs: 200 * 86_400_000 })),
      ),
    ).toContain('INVALID_TIMEOUT');
    expect(
      codes(mutate((g) => (g.nodes[3].config = { approvalType: 'X' }))),
    ).toContain('INVALID_TIMEOUT');
  });
  it('a wait step needs a target and a timeout', () => {
    const g = good();
    g.nodes[4] = {
      id: 'wait',
      type: 'WAIT',
      config: { until: 'payment.received' },
    };
    expect(codes(validateGraph(g))).toContain('INVALID_TIMEOUT');
    g.nodes[4] = { id: 'wait', type: 'WAIT', config: { timeoutMs: 1000 } };
    expect(codes(validateGraph(g))).toContain('MISSING_WAIT_TARGET');
  });
  it('escalation levels must be positive and increasing', () => {
    const g = good();
    g.nodes[2] = {
      id: 'mail',
      type: 'ESCALATION',
      config: { steps: [{ afterMs: 7_200_000 }, { afterMs: 3_600_000 }] },
    };
    expect(codes(validateGraph(g))).toContain('INVALID_TIMEOUT');
    g.nodes[2] = { id: 'mail', type: 'ESCALATION', config: { steps: [] } };
    expect(codes(validateGraph(g))).toContain('MISSING_ESCALATION');
    g.nodes[2] = {
      id: 'mail',
      type: 'ESCALATION',
      config: { steps: [{ afterMs: 3_600_000 }, { afterMs: 7_200_000 }] },
    };
    expect(validateGraph(g)).toEqual([]);
  });
  it('limits size and rejects odd ids', () => {
    const big: WorkflowGraph = {
      nodes: Array.from({ length: 60 }, (_, i) => ({
        id: `n${i}`,
        type: 'END' as const,
      })),
      edges: [],
    };
    expect(codes(validateGraph(big))).toContain('TOO_MANY_NODES');
    expect(
      codes(mutate((g) => g.nodes.push({ id: '1bad id', type: 'END' }))),
    ).toContain('BAD_ID');
  });
  it('hasErrors distinguishes errors from warnings', () => {
    expect(hasErrors([{ level: 'warning', code: 'X', message: '' }])).toBe(
      false,
    );
    expect(hasErrors([{ level: 'error', code: 'X', message: '' }])).toBe(true);
  });
});

describe('nextNode', () => {
  it('follows the labelled edge', () => {
    const g = good();
    expect(nextNode(g, 'big', 'true')).toBe('mail');
    expect(nextNode(g, 'big', 'false')).toBe('done');
    expect(nextNode(g, 'start')).toBe('big');
    expect(nextNode(g, 'done')).toBeNull();
    expect(nextNode(g, 'approve', 'timeout')).toBeNull();
  });
});
