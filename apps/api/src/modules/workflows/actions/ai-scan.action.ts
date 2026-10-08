import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { ActionContext, WorkflowAction } from './action.types';

/** The seam to the AI layer: workflows depend on this interface, never on the agent runtime. */
export const AI_DAILY_SCAN = 'AI_DAILY_SCAN';

export interface AiDailyScan {
  runForCompany(companyId: string): Promise<{
    scans: { scanner: string; found: number; created: number }[];
    briefingId: string;
  }>;
}

/**
 * Runs the AI exception scan and builds the daily briefing for the workflow's own company. It is rule-based
 * detection that files recommendations (idempotent: the same finding is one row, so a daily schedule never
 * creates duplicate work) — it takes no action on customers or money. Schedule it from a workflow trigger to
 * run "every morning".
 */
export class AiScanAction implements WorkflowAction {
  key = 'ai.scan';
  label = 'Run the AI exception scan and daily briefing';
  sideEffect = 'NONE' as const;
  requiredPermissions = [PERMISSIONS.AI.ADMIN];

  constructor(private readonly scan: AiDailyScan) {}

  validate(): string[] {
    return [];
  }

  async run(ctx: ActionContext): Promise<Record<string, unknown>> {
    const r = await this.scan.runForCompany(ctx.companyId);
    return {
      scanned: r.scans.length,
      found: r.scans.reduce((n, s) => n + s.found, 0),
      created: r.scans.reduce((n, s) => n + s.created, 0),
      briefingId: r.briefingId,
    };
  }

  /** Test mode: say what would happen, change nothing. */
  mock(): Record<string, unknown> {
    return { wouldScan: true, note: 'Test mode: no scan was run' };
  }
}
