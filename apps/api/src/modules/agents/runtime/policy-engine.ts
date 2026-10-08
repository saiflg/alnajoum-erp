import { AiRiskLevel } from '@prisma/client';
import {
  AgentConfig,
  AutonomyLevel,
  PolicyDecision,
  Principal,
  ResolvedControls,
  ToolDefinition,
} from '../agent.types';

export interface PolicyInput {
  tool: ToolDefinition | undefined;
  toolKey: string;
  agentAudience: string;
  config: AgentConfig;
  principal: Principal;
  controls: ResolvedControls;
  dryRun: boolean;
}

const clamp = (n: number): AutonomyLevel =>
  Math.max(0, Math.min(5, Math.floor(n))) as AutonomyLevel;

/**
 * The lowest of: the agent's own level, the platform/tenant cap. The "autonomous execution disabled" switch
 * drops it to 2 (drafts and tasks only); the "force approval" switch is handled separately.
 */
export function effectiveAutonomy(
  config: AgentConfig,
  controls: ResolvedControls,
): AutonomyLevel {
  let level = Math.min(config.autonomyLevel, controls.autonomyCap);
  if (controls.autonomousDisabled) level = Math.min(level, 2);
  return clamp(level);
}

/**
 * Decides, in code, what happens when a model asks for a tool. The model's request is only a request:
 *
 *  1. unknown tool, or one outside the agent's list           → DENY (and a safety event)
 *  2. kill switch (all / this tool)                           → DENY
 *  3. the human principal lacks the tool's permissions        → DENY (an agent never has more than its user)
 *  4. risk × autonomy:
 *       READ_ONLY       always allowed
 *       recommend tool  needs level ≥ 1
 *       LOW_RISK_WRITE  level ≥ 2 → ALLOW, else PROPOSE_ONLY
 *       MEDIUM_RISK     level ≥ 3 and not forced → ALLOW (self-service on own record) else REQUIRE_APPROVAL
 *       HIGH_RISK       ALWAYS REQUIRE_APPROVAL — no level, flag or configuration changes this
 *  5. force-approval switch turns every write into REQUIRE_APPROVAL.
 */
export function decide(input: PolicyInput): PolicyDecision {
  const { tool, toolKey, config, principal, controls } = input;
  const level = effectiveAutonomy(config, controls);
  const deny = (
    reason: string,
    safetyKind?: PolicyDecision['safetyKind'],
  ): PolicyDecision => ({
    outcome: 'DENY',
    reason,
    safetyKind,
    effectiveAutonomy: level,
  });

  if (!tool) return deny(`Unknown tool "${toolKey}"`, 'UNAUTHORIZED_ACTION');
  if (!config.tools.includes(toolKey))
    return deny(
      `The ${input.agentAudience.toLowerCase()} agent is not allowed to use "${toolKey}"`,
      'UNAUTHORIZED_ACTION',
    );
  if (config.prohibitedActions.includes(toolKey))
    return deny(
      `"${toolKey}" is prohibited for this agent`,
      'UNAUTHORIZED_ACTION',
    );
  if (!tool.audiences.includes(input.agentAudience as never))
    return deny(
      `"${toolKey}" is not available to this kind of agent`,
      'POLICY_VIOLATION',
    );
  if (controls.allDisabled) return deny('All AI is switched off');
  if (controls.agentDisabled) return deny('This agent is switched off');
  if (controls.disabledTools.has(toolKey))
    return deny(`The tool "${toolKey}" is switched off`);

  if (principal.kind === 'CUSTOMER' && tool.requiredPermissions.length > 0) {
    return deny(`"${toolKey}" is a staff-only tool`, 'UNAUTHORIZED_ACTION');
  }
  if (principal.kind === 'STAFF' || principal.kind === 'SYSTEM') {
    const missing = tool.requiredPermissions.filter(
      (p) => !principal.permissions.includes(p) && !principal.isSuperAdmin,
    );
    if (missing.length > 0 && principal.kind === 'STAFF')
      return deny(
        `You do not have the permission this needs (${missing.join(', ')}), so the assistant cannot do it for you`,
        'UNAUTHORIZED_ACTION',
      );
  }

  const approval = (reason: string): PolicyDecision => ({
    outcome: 'REQUIRE_APPROVAL',
    reason,
    effectiveAutonomy: level,
  });

  if (tool.risk === AiRiskLevel.READ_ONLY && !tool.writes)
    return { outcome: 'ALLOW', reason: 'Read-only', effectiveAutonomy: level };

  if (tool.recommends) {
    return level >= 1
      ? { outcome: 'ALLOW', reason: 'Recommendation', effectiveAutonomy: level }
      : {
          outcome: 'DENY',
          reason: 'This agent may only answer (autonomy level 0)',
          effectiveAutonomy: level,
        };
  }

  if (tool.risk === AiRiskLevel.HIGH_RISK)
    return approval('High-risk actions always need explicit human approval');

  if (controls.forceApproval)
    return approval('Human approval is being forced for all AI actions');

  if (tool.risk === AiRiskLevel.LOW_RISK_WRITE) {
    return level >= 2
      ? {
          outcome: 'ALLOW',
          reason: 'Low-risk write within autonomy',
          effectiveAutonomy: level,
        }
      : {
          outcome: 'PROPOSE_ONLY',
          reason: 'Autonomy level is below drafts/tasks',
          effectiveAutonomy: level,
        };
  }

  // MEDIUM_RISK: a customer acting on their own record (pay my invoice) may be automatic from level 3; anything
  // else is automatic only from level 4, and only for tools that are not HIGH_RISK.
  const direct =
    tool.selfService && principal.kind === 'CUSTOMER' ? level >= 3 : level >= 4;
  return direct
    ? {
        outcome: 'ALLOW',
        reason: 'Medium-risk action within autonomy',
        effectiveAutonomy: level,
      }
    : approval('Medium-risk action needs approval at this autonomy level');
}
