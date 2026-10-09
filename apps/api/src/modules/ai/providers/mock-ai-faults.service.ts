import { Injectable } from '@nestjs/common';

export type MockFaultMode =
  'NONE' | 'FAIL' | 'TIMEOUT' | 'MALFORMED' | 'OUTAGE' | 'EMPTY';

export interface MockFault {
  mode: MockFaultMode;
  /** How many calls it applies to (0 = until cleared; OUTAGE ignores it). */
  times?: number;
  /** For TIMEOUT: how long the call hangs. */
  delayMs?: number;
  /** Only for this agent key (all agents when empty). */
  agent?: string;
}

/**
 * Lets automated tests (and the localhost-only simulator) make the mock AI provider misbehave on purpose:
 * fail, hang, return malformed output, or be down entirely. Never active in production (the setter refuses),
 * and a real provider is never affected.
 */
@Injectable()
export class MockAiFaultService {
  private fault: MockFault = { mode: 'NONE' };
  private remaining = 0;

  set(fault: MockFault): void {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Mock AI faults are disabled in production');
    this.fault = fault;
    this.remaining = fault.times ?? 0;
  }
  clear(): void {
    this.fault = { mode: 'NONE' };
    this.remaining = 0;
  }
  current(): MockFault {
    return this.fault;
  }

  /** The fault to apply to this call, consuming one use of a counted fault. */
  take(agent?: string): MockFault | null {
    const f = this.fault;
    if (f.mode === 'NONE') return null;
    if (f.agent && f.agent !== agent) return null;
    if (f.mode !== 'OUTAGE' && (f.times ?? 0) > 0) {
      if (this.remaining <= 0) return null;
      this.remaining -= 1;
      if (this.remaining === 0) {
        const applied = f;
        this.fault = { mode: 'NONE' };
        return applied;
      }
    }
    return f;
  }
}
