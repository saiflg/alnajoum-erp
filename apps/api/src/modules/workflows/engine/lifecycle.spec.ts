import {
  canTransition,
  isRetryableReason,
  isTerminal,
  reactsToEvents,
  WorkflowStatus,
} from './lifecycle';

describe('workflow lifecycle', () => {
  it('draft can be tested, activated or archived', () => {
    for (const to of ['TESTING', 'ACTIVE', 'ARCHIVED'] as const)
      expect(canTransition('DRAFT', to)).toBe(true);
    expect(canTransition('DRAFT', 'PAUSED')).toBe(false);
  });
  it('active can be paused or disabled, and paused can resume', () => {
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransition('ACTIVE', 'DISABLED')).toBe(true);
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransition('DISABLED', 'ACTIVE')).toBe(true);
  });
  it('an ACTIVE workflow cannot be archived directly (it must be stopped first)', () => {
    expect(canTransition('ACTIVE', 'ARCHIVED')).toBe(false);
    expect(canTransition('PAUSED', 'ARCHIVED')).toBe(true);
  });
  it('archived is final', () => {
    for (const to of [
      'DRAFT',
      'TESTING',
      'ACTIVE',
      'PAUSED',
      'DISABLED',
      'ARCHIVED',
    ] as WorkflowStatus[])
      expect(canTransition('ARCHIVED', to)).toBe(false);
  });
  it('only ACTIVE reacts to live events', () => {
    for (const s of [
      'DRAFT',
      'TESTING',
      'PAUSED',
      'DISABLED',
      'ARCHIVED',
    ] as WorkflowStatus[])
      expect(reactsToEvents(s)).toBe(false);
    expect(reactsToEvents('ACTIVE')).toBe(true);
  });
  it('knows which execution states are terminal', () => {
    for (const s of [
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'DEAD_LETTERED',
    ] as const)
      expect(isTerminal(s)).toBe(true);
    for (const s of ['RUNNING', 'WAITING'] as const)
      expect(isTerminal(s)).toBe(false);
  });
  it('does not offer a retry when the workflow itself is the problem', () => {
    for (const r of [
      'LOOP_CYCLE',
      'LOOP_MAX_DEPTH',
      'GRAPH',
      'UNKNOWN_ACTION',
      'CONDITION_INVALID',
      'TEMPLATE',
      'CROSS_TENANT',
      'NO_ROUTE',
    ])
      expect(isRetryableReason(r)).toBe(false);
    for (const r of [
      'PROVIDER_FAILED',
      'ACTION_FAILED',
      'WAIT_TIMEOUT',
      'APPROVAL_TIMEOUT',
    ])
      expect(isRetryableReason(r)).toBe(true);
  });
});
