import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AiApprovalStatus, AiRecommendationStatus } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { RequireStepUp } from '../../../common/security/step-up';
import { resolveTenantFilter } from '../../../common/utils/tenant.util';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { INTEGRATION_CATALOG } from '../../integrations/integration-catalog';
import { MockAiFaultService } from '../../ai/providers/mock-ai-faults.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { AGENT_BY_KEY } from '../agent-catalog';
import {
  AgentStatusDto,
  ApplyPassportDto,
  CallDto,
  ProposeDocumentDto,
  TriageDto,
  AssistantMessageDto,
  BudgetDto,
  ClearControlDto,
  ControlDto,
  CopilotAskDto,
  CustomerFeedbackDto,
  DecideApprovalDto,
  DraftVersionDto,
  FeedbackDto,
  KnowledgeDto,
  MockFaultDto,
  RecommendationStatusDto,
  RecommendationTaskDto,
  ReplyDto,
  RollbackDto,
  ScanDto,
  SimulateDto,
} from '../dto/agents.dto';
import { AgentAdminService } from '../services/agent-admin.service';
import { AgentRunnerService } from '../services/agent-runner.service';
import { AiApprovalsService } from '../services/ai-approvals.service';
import { AiAssistService } from '../services/assist.service';
import { AiBudgetService } from '../services/budget.service';
import { ConversationsService } from '../services/conversations.service';
import { AiControlsService, GLOBAL } from '../services/controls.service';
import { DailyOperationsService } from '../services/daily-operations.service';
import { AiFeedbackService } from '../services/feedback.service';
import { AiKnowledgeService } from '../services/knowledge.service';
import { AiMemoryService } from '../services/memory.service';
import { AiObservabilityService } from '../services/observability.service';
import { OperationsScannerService } from '../services/operations-scanner.service';
import { PrincipalService } from '../services/principal.service';
import { AiRecommendationsService } from '../services/recommendations.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { resolveCustomer } from '../tools/tool-support';

const P = PERMISSIONS.AI;
const tenantOf = (u: AuthContext) => resolveTenantFilter(u);

/**
 * HTTP surface of the agent layer. Every route authenticates, resolves the caller's real principal, and works
 * only inside their company (and branch, where branch-limited). Customer routes accept customers only; nothing
 * here lets a caller choose another tenant, another customer, or a tool.
 */
@Controller('ai')
export class AgentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AgentRunnerService,
    private readonly admin: AgentAdminService,
    private readonly tools: ToolRegistryService,
    private readonly controls: AiControlsService,
    private readonly budgets: AiBudgetService,
    private readonly knowledge: AiKnowledgeService,
    private readonly memory: AiMemoryService,
    private readonly approvals: AiApprovalsService,
    private readonly conversations: ConversationsService,
    private readonly feedback: AiFeedbackService,
    private readonly observability: AiObservabilityService,
    private readonly recs: AiRecommendationsService,
    private readonly scanner: OperationsScannerService,
    private readonly daily: DailyOperationsService,
    private readonly principals: PrincipalService,
    private readonly integrations: IntegrationsService,
    private readonly faults: MockAiFaultService,
    private readonly assist: AiAssistService,
  ) {}

  // ================================================================== customer assistant
  @Post('assistant/message')
  @RequirePermissions()
  assistantMessage(
    @CurrentUser() user: AuthContext,
    @Body() dto: AssistantMessageDto,
  ) {
    return this.conversations.customerMessage(user, dto);
  }
  @Get('assistant/conversations')
  @RequirePermissions()
  myConversations(@CurrentUser() user: AuthContext) {
    return this.conversations.listMine(user);
  }
  @Get('assistant/conversations/:id')
  @RequirePermissions()
  myConversation(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversations.getMine(user, id);
  }
  @Post('assistant/conversations/:id/human')
  @RequirePermissions()
  requestHuman(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversations.requestHuman(user, id);
  }
  @Post('assistant/feedback')
  @RequirePermissions()
  async customerFeedback(
    @CurrentUser() user: AuthContext,
    @Body() dto: CustomerFeedbackDto,
  ) {
    const p = await this.principals.fromAuth(user);
    if (!p.customerId) throw new ForbiddenException('Customers only');
    return this.feedback.submit(dto, {
      identityId: user.sub,
      companyId: p.companyId,
      isSuperAdmin: false,
      customerId: p.customerId,
    });
  }
  @Get('assistant/memory')
  @RequirePermissions()
  async myMemory(@CurrentUser() user: AuthContext) {
    const p = await this.principals.fromAuth(user);
    if (!p.customerId || !p.companyId)
      throw new ForbiddenException('Customers only');
    return (
      await this.memory.forSubject(p.companyId, 'CUSTOMER', p.customerId)
    ).map((m) => ({
      id: m.id,
      type: m.type,
      key: m.key,
      value: m.value,
      expiresAt: m.expiresAt,
    }));
  }
  @Delete('assistant/memory')
  @RequirePermissions()
  async forgetMe(@CurrentUser() user: AuthContext) {
    const p = await this.principals.fromAuth(user);
    if (!p.customerId || !p.companyId)
      throw new ForbiddenException('Customers only');
    return this.memory.deleteForSubject(p.companyId, 'CUSTOMER', p.customerId);
  }

  // ================================================================== staff copilot
  @Post('copilot/ask')
  @RequirePermissions(P.COPILOT_USE)
  async ask(@CurrentUser() user: AuthContext, @Body() dto: CopilotAskDto) {
    const key = dto.agent ?? 'staff_copilot';
    const def = AGENT_BY_KEY.get(key);
    if (!def || def.audience === 'CUSTOMER' || def.audience === 'SYSTEM')
      throw new NotFoundException('No such assistant');
    if (
      def.audience === 'EXECUTIVE' &&
      !user.permissions.includes(P.EXECUTIVE_VIEW) &&
      !user.roles.includes('SUPER_ADMIN')
    )
      throw new ForbiddenException(
        'The executive assistant needs the executive view permission',
      );
    const principal = await this.principals.fromAuth(user);
    return this.runner.run({
      agentKey: key,
      objective: dto.objective,
      principal,
      channel: 'STAFF',
      language: dto.language,
    });
  }

  @Post('simulate')
  @RequirePermissions(P.COPILOT_USE)
  async simulate(@CurrentUser() user: AuthContext, @Body() dto: SimulateDto) {
    const def = AGENT_BY_KEY.get(dto.agent);
    if (!def) throw new NotFoundException('No such agent');
    let principal = await this.principals.fromAuth(user);
    if (def.audience === 'CUSTOMER') {
      // "What would the agent do if THIS customer asked?" — only for a customer this person may see.
      const c = await resolveCustomer(
        this.prisma,
        principal,
        dto.customerId,
      ).catch(() => {
        throw new BadRequestException(
          'Give a customerId (in your company) to simulate as',
        );
      });
      const row = await this.prisma.customer.findUnique({
        where: { id: c.id },
        select: { identityId: true, companyId: true, assignedBranchId: true },
      });
      principal = {
        ...principal,
        kind: 'CUSTOMER',
        customerId: c.id,
        identityId: row!.identityId,
        companyId: row!.companyId,
        branchId: row!.assignedBranchId,
        permissions: [],
        roles: ['CUSTOMER'],
        branchLimited: false,
        isSuperAdmin: false,
        staffId: null,
      };
    }
    return this.runner.simulate({
      agentKey: dto.agent,
      objective: dto.objective,
      principal,
      language: dto.language,
    });
  }

  // ================================================================== document, email and call assistants (proposals only)
  @Post('documents/propose')
  @RequirePermissions(P.COPILOT_USE)
  proposeDocument(
    @CurrentUser() user: AuthContext,
    @Body() dto: ProposeDocumentDto,
  ) {
    return this.assist.proposeDocument(user, dto);
  }
  @Post('documents/apply-passport')
  @RequirePermissions(P.COPILOT_USE, PERMISSIONS.CUSTOMER.UPDATE)
  applyPassport(
    @CurrentUser() user: AuthContext,
    @Body() dto: ApplyPassportDto,
  ) {
    return this.assist.applyPassport(user, dto);
  }
  @Post('email/triage')
  @RequirePermissions(P.COPILOT_USE)
  triageEmail(@CurrentUser() user: AuthContext, @Body() dto: TriageDto) {
    return this.assist.triageEmail(user, dto);
  }
  @Post('voice/transcript')
  @RequirePermissions(P.COPILOT_USE)
  processCall(@CurrentUser() user: AuthContext, @Body() dto: CallDto) {
    return this.assist.processCall(user, dto);
  }

  // ================================================================== approvals
  @Get('approvals')
  @RequirePermissions(P.APPROVE)
  listApprovals(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: AiApprovalStatus,
  ) {
    return this.approvals.list(tenantOf(user), status);
  }
  @Get('approvals/:id')
  @RequirePermissions(P.APPROVE)
  getApproval(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.approvals.get(id, tenantOf(user));
  }
  @Post('approvals/:id/decide')
  @RequirePermissions(P.APPROVE)
  decideApproval(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
  ) {
    return this.approvals.decide(
      id,
      user,
      dto.decision,
      dto.note,
      dto.editedParams,
    );
  }

  // ================================================================== exceptions, control tower, briefing
  @Get('recommendations')
  @RequirePermissions(P.OPERATIONS_VIEW)
  async recommendations(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: AiRecommendationStatus,
    @Query('severity') severity?: string,
    @Query('agent') agent?: string,
  ) {
    const p = await this.principals.fromAuth(user);
    return this.recs.list(tenantOf(user), {
      status,
      severity,
      agentKey: agent,
      branchLimitedTo: p.branchLimited ? p.branchId : null,
    });
  }
  @Post('recommendations/:id/status')
  @RequirePermissions(P.OPERATIONS_VIEW)
  recStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecommendationStatusDto,
  ) {
    return this.recs.setStatus(id, dto.status, tenantOf(user), {
      identityId: user.sub,
    });
  }
  @Post('recommendations/:id/task')
  @RequirePermissions(P.OPERATIONS_VIEW, PERMISSIONS.CRM.TASK_MANAGE)
  async recTask(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecommendationTaskDto,
  ) {
    const p = await this.principals.fromAuth(user);
    const staffId = dto.staffId ?? p.staffId;
    if (!staffId) throw new BadRequestException('Choose who the task is for');
    return this.recs.createTask(id, tenantOf(user), staffId, {
      identityId: user.sub,
      staffId: p.staffId,
    });
  }

  @Get('control-tower')
  @RequirePermissions(P.OPERATIONS_VIEW)
  async controlTower(@CurrentUser() user: AuthContext) {
    const tenant = tenantOf(user);
    const p = await this.principals.fromAuth(user);
    const items = await this.recs.list(
      tenant,
      { branchLimitedTo: p.branchLimited ? p.branchId : null },
      300,
    );
    const bySeverity: Record<string, typeof items> = {
      CRITICAL: [],
      HIGH: [],
      MEDIUM: [],
      LOW: [],
    };
    for (const i of items) (bySeverity[i.severity] ??= []).push(i);
    const domain = (kinds: string[]) =>
      items.filter((i) => kinds.includes(i.kind)).length;
    const [pendingApprovals, failedExecutions, openIncidents, handoffs] =
      await Promise.all([
        this.prisma.aiApproval.count({
          where: {
            ...(tenant ? { companyId: tenant } : {}),
            status: 'PENDING',
          },
        }),
        this.prisma.aiExecution.count({
          where: {
            ...(tenant ? { companyId: tenant } : {}),
            status: 'FAILED',
            startedAt: { gte: new Date(Date.now() - 86_400_000) },
          },
        }),
        this.prisma.securityIncident.count({
          where: {
            ...(tenant ? { companyId: tenant } : {}),
            status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] },
          },
        }),
        this.prisma.aiConversation.count({
          where: { ...(tenant ? { companyId: tenant } : {}), status: 'PAUSED' },
        }),
      ]);
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        critical: bySeverity.CRITICAL.length,
        high: bySeverity.HIGH.length,
        medium: bySeverity.MEDIUM.length,
        low: bySeverity.LOW.length,
        pendingApprovals,
        failedAgentRuns24h: failedExecutions,
        openSecurityIncidents: openIncidents,
        customersWaitingForAPerson: handoffs,
      },
      domains: {
        flights: domain(['HOLD_EXPIRING']),
        hotels: 0,
        visas: domain(['VISA_DOCUMENT_MISSING', 'VISA_DELAYED']),
        pilgrimage: domain(['GROUP_NOT_READY']),
        payments: domain([
          'PAYMENT_PENDING_TOO_LONG',
          'MANUAL_PAYMENT_WAITING',
          'UNMATCHED_BANK_LINE',
          'POSSIBLE_DUPLICATE_PAYMENT',
          'BALANCE_OVERDUE',
        ]),
        suppliers: domain(['CONTRACT_EXPIRING', 'PROVIDER_FAILURES']),
        support: domain(['TICKET_UNRESOLVED', 'SUPPORT_ESCALATION']),
        automation: domain(['WORKFLOW_FAILED']),
        security: domain([
          'LOGIN_FAILURE_SPIKE',
          'ESCALATION_ATTEMPTS',
          'OPEN_CRITICAL_INCIDENT',
        ]),
      },
      queue: bySeverity,
      note: "Findings are detected by fixed rules over recorded data; the order is a transparent priority score (see each item's evidence).",
    };
  }

  @Post('scan')
  @RequirePermissions(P.ADMIN)
  async scan(@CurrentUser() user: AuthContext, @Body() dto: ScanDto) {
    const tenant = tenantOf(user);
    if (tenant === undefined && !dto.companyId) return this.daily.runAll();
    const companyId = tenant ?? user.companyId;
    if (!companyId) throw new BadRequestException('No company');
    if (dto.companyId && tenant !== undefined && dto.companyId !== tenant)
      throw new NotFoundException('Company not found');
    return this.daily.runForCompany(dto.companyId ?? companyId);
  }
  @Get('briefing')
  @RequirePermissions(P.EXECUTIVE_VIEW)
  async briefing(@CurrentUser() user: AuthContext) {
    const companyId = user.companyId;
    if (!companyId)
      throw new BadRequestException(
        'Platform administrators read a company briefing by signing in to that company',
      );
    return (
      (await this.daily.latestBriefing(companyId)) ??
      this.daily.briefing(companyId)
    );
  }
  @Post('briefing/generate')
  @RequirePermissions(P.EXECUTIVE_VIEW)
  generateBriefing(@CurrentUser() user: AuthContext) {
    if (!user.companyId) throw new BadRequestException('No company');
    return this.daily.briefing(user.companyId);
  }

  // ================================================================== staff view of customer conversations
  @Get('conversations')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  conversationList(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: 'AI_ACTIVE' | 'PAUSED' | 'HUMAN_TAKEN' | 'CLOSED',
  ) {
    return this.conversations.listForStaff(user, status);
  }
  @Get('conversations/:id')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  conversationInspect(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ) {
    return this.conversations.inspect(user, id);
  }
  @Post('conversations/:id/takeover')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  takeover(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversations.takeOver(user, id);
  }
  @Post('conversations/:id/pause')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  pause(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversations.pause(user, id);
  }
  @Post('conversations/:id/resume')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  resume(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversations.resume(user, id);
  }
  @Post('conversations/:id/close')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  close(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversations.close(user, id);
  }
  @Post('conversations/:id/reply')
  @RequirePermissions(P.CONVERSATION_MANAGE)
  reply(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.conversations.staffReply(user, id, dto.content);
  }

  @Post('feedback')
  @RequirePermissions(P.FEEDBACK)
  async rate(@CurrentUser() user: AuthContext, @Body() dto: FeedbackDto) {
    const p = await this.principals.fromAuth(user);
    return this.feedback.submit(dto, {
      identityId: user.sub,
      companyId: p.companyId,
      isSuperAdmin: p.isSuperAdmin,
    });
  }

  // ================================================================== governance (admin)
  @Get('overview')
  @RequirePermissions(P.ADMIN)
  overview(@CurrentUser() user: AuthContext, @Query('days') days?: string) {
    return this.observability.overview(
      tenantOf(user),
      Math.min(90, Math.max(1, Number(days) || 7)),
    );
  }
  @Get('executions')
  @RequirePermissions(P.ADMIN)
  executions(
    @CurrentUser() user: AuthContext,
    @Query('agent') agent?: string,
    @Query('status') status?: string,
  ) {
    return this.observability.executions(tenantOf(user), {
      agentKey: agent,
      status,
    });
  }
  @Get('executions/:id')
  @RequirePermissions(P.ADMIN)
  async execution(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const e = await this.observability.execution(tenantOf(user), id);
    if (!e) throw new NotFoundException('Execution not found');
    return e;
  }
  @Get('safety-events')
  @RequirePermissions(P.ADMIN)
  safety(@CurrentUser() user: AuthContext) {
    return this.observability.safetyEvents(tenantOf(user));
  }
  @Get('audit')
  @RequirePermissions(P.ADMIN)
  auditTrail(@CurrentUser() user: AuthContext) {
    return this.observability.actionAudit(tenantOf(user));
  }
  @Get('feedback')
  @RequirePermissions(P.ADMIN)
  feedbackList(@CurrentUser() user: AuthContext) {
    return this.feedback.list(tenantOf(user));
  }

  @Get('agents')
  @RequirePermissions(P.ADMIN)
  agents() {
    return this.admin.list();
  }
  @Get('agents/:key/versions')
  @RequirePermissions(P.ADMIN)
  versions(@Param('key') key: string) {
    return this.admin.versions(key);
  }
  @Post('agents/:key/versions')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(P.ADMIN)
  draft(
    @CurrentUser() user: AuthContext,
    @Param('key') key: string,
    @Body() dto: DraftVersionDto,
  ) {
    return this.admin.draftVersion(key, dto, { identityId: user.sub });
  }
  @Post('versions/:id/publish')
  @Roles('SUPER_ADMIN')
  @RequireStepUp()
  @RequirePermissions(P.ADMIN)
  publish(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.admin.publishVersion(
      id,
      user.sub,
      'Published from the AI control centre',
    );
  }
  @Post('agents/:key/rollback')
  @Roles('SUPER_ADMIN')
  @RequireStepUp()
  @RequirePermissions(P.ADMIN)
  rollback(
    @CurrentUser() user: AuthContext,
    @Param('key') key: string,
    @Body() dto: RollbackDto,
  ) {
    return this.admin.rollback(
      key,
      dto.toVersion,
      { identityId: user.sub },
      dto.note,
    );
  }
  @Post('agents/:key/status')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(P.ADMIN)
  agentStatus(
    @CurrentUser() user: AuthContext,
    @Param('key') key: string,
    @Body() dto: AgentStatusDto,
  ) {
    return this.admin.setAgentStatus(
      key,
      dto.status,
      { identityId: user.sub },
      dto.reason,
    );
  }
  @Post('agents/sync-catalog')
  @Roles('SUPER_ADMIN')
  @RequireStepUp()
  @RequirePermissions(P.ADMIN)
  sync(@CurrentUser() user: AuthContext) {
    return this.admin.syncCatalog(true, user.sub);
  }

  /** Tools with their risk, who may use them, and which agents hold them (the permission matrix). */
  @Get('tools')
  @RequirePermissions(P.ADMIN)
  async toolMatrix() {
    const agents = await this.admin.list();
    return this.tools.all().map((t) => ({
      key: t.key,
      description: t.description,
      risk: t.risk,
      writes: t.writes,
      audiences: t.audiences,
      requiresPermissions: t.requiredPermissions,
      executesAfterApproval: t.executeOnApproval ?? false,
      selfService: t.selfService ?? false,
      agents: agents
        .filter((a) =>
          (
            (a.currentVersion?.config as { tools?: string[] } | null)?.tools ??
            []
          ).includes(t.key),
        )
        .map((a) => a.key),
    }));
  }

  @Get('controls')
  @RequirePermissions(P.ADMIN)
  controlList(@CurrentUser() user: AuthContext) {
    return this.controls.list(user.companyId);
  }
  /** Turning a protection ON never needs step-up (it must be instant in an emergency). */
  @Post('controls')
  @RequirePermissions(P.ADMIN)
  setControl(@CurrentUser() user: AuthContext, @Body() dto: ControlDto) {
    const { scopeKey } = this.scopeFor(user, dto.scope, dto.companyId);
    return this.controls.set(scopeKey, dto, {
      identityId: user.sub,
      companyId: user.companyId,
    });
  }
  /** Lifting a protection is deliberate: it needs a fresh proof of identity. */
  @Post('controls/clear')
  @RequireStepUp()
  @RequirePermissions(P.ADMIN)
  clearControl(@CurrentUser() user: AuthContext, @Body() dto: ClearControlDto) {
    const { scopeKey } = this.scopeFor(user, dto.scope, dto.companyId);
    return this.controls.clear(scopeKey, dto.kind, dto.targetKey ?? '', {
      identityId: user.sub,
      companyId: user.companyId,
    });
  }
  private scopeFor(user: AuthContext, scope?: string, companyId?: string) {
    if (scope === 'GLOBAL') {
      if (!user.roles.includes('SUPER_ADMIN'))
        throw new ForbiddenException(
          'Only a platform administrator can change platform-wide AI controls',
        );
      return { scopeKey: GLOBAL };
    }
    const own = user.companyId;
    if (companyId && companyId !== own && !user.roles.includes('SUPER_ADMIN'))
      throw new NotFoundException('Company not found');
    const target = companyId ?? own;
    if (!target) throw new BadRequestException('Choose a company');
    return { scopeKey: target };
  }

  @Get('budgets')
  @RequirePermissions(P.ADMIN)
  budgetList(@CurrentUser() user: AuthContext) {
    return this.budgets.list(user.companyId);
  }
  @Get('budgets/usage')
  @RequirePermissions(P.ADMIN)
  async budgetUsage(
    @CurrentUser() user: AuthContext,
    @Query('agent') agent?: string,
  ) {
    return this.budgets.check(user.companyId, agent ?? '');
  }
  @Post('budgets')
  @RequirePermissions(P.ADMIN)
  setBudget(@CurrentUser() user: AuthContext, @Body() dto: BudgetDto) {
    const { scopeKey } = this.scopeFor(user, dto.scope);
    return this.budgets.set(scopeKey, dto, { identityId: user.sub });
  }

  @Get('knowledge')
  @RequirePermissions(P.ADMIN)
  knowledgeList(@CurrentUser() user: AuthContext) {
    return this.knowledge.list(user.companyId);
  }
  @Post('knowledge')
  @RequirePermissions(P.ADMIN)
  knowledgeSave(@CurrentUser() user: AuthContext, @Body() dto: KnowledgeDto) {
    if (dto.platformWide && !user.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException(
        'Only a platform administrator can publish platform-wide knowledge',
      );
    if (!dto.platformWide && !user.companyId)
      throw new BadRequestException('Choose a company');
    return this.knowledge.create(
      {
        ...dto,
        companyId: dto.platformWide ? null : user.companyId,
        effectiveFrom: dto.effectiveFrom
          ? new Date(dto.effectiveFrom)
          : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
      { identityId: user.sub },
    );
  }
  @Post('knowledge/:id/retire')
  @RequirePermissions(P.ADMIN)
  knowledgeRetire(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.knowledge.retire(
      id,
      user.roles.includes('SUPER_ADMIN') ? null : user.companyId,
      { identityId: user.sub },
    );
  }

  @Get('memory')
  @RequirePermissions(P.ADMIN)
  async memoryOf(
    @CurrentUser() user: AuthContext,
    @Query('subjectType') subjectType: string,
    @Query('subjectId') subjectId: string,
  ) {
    if (!user.companyId || !subjectType || !subjectId)
      throw new BadRequestException('subjectType and subjectId are required');
    return this.memory.forSubject(user.companyId, subjectType, subjectId);
  }
  @Delete('memory/:id')
  @RequirePermissions(P.ADMIN)
  forget(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    if (!user.companyId) throw new BadRequestException('No company');
    return this.memory.deleteOne(user.companyId, id);
  }

  /** External AI provider configuration, explicit and read-only here (edited under Integrations by a Super Admin). */
  @Get('providers')
  @RequirePermissions(P.ADMIN)
  async providers() {
    const active = (await this.integrations.getActiveProvider('AI')) ?? 'mock';
    const out: Record<string, unknown>[] = [];
    for (const spec of INTEGRATION_CATALOG.AI) {
      const cfg =
        (await this.integrations
          .getCredentialConfig('AI', spec.provider)
          .catch(() => null)) ?? {};
      const external = spec.provider !== 'mock';
      const declared = !!(cfg.region && cfg.dataSharing && cfg.retention);
      const host = (() => {
        try {
          return cfg.baseUrl ? new URL(String(cfg.baseUrl)).host : null;
        } catch {
          return 'invalid URL';
        }
      })();
      out.push({
        provider: spec.provider,
        label: spec.label,
        active: spec.provider === active,
        external,
        model:
          cfg.model ??
          (external ? 'provider default' : 'mock-agent-planner-v1'),
        endpointHost: host,
        region: cfg.region ?? null,
        dataSharing: cfg.dataSharing ?? null,
        retention: cfg.retention ?? null,
        costNote: external
          ? 'Estimated from AI_COST_PER_1K_PROMPT_MICROS / AI_COST_PER_1K_COMPLETION_MICROS'
          : 'No cost (local)',
        keyConfigured: external ? !!cfg.apiKey : null,
        securityStatus: !external
          ? 'LOCAL'
          : !cfg.apiKey
            ? 'INCOMPLETE: no key'
            : !declared
              ? 'INCOMPLETE: data handling not declared'
              : 'DECLARED',
        note: external
          ? "The platform does not assume this provider's privacy terms; the fields above are what an administrator has stated."
          : 'Runs inside this application; nothing leaves it.',
      });
    }
    return out;
  }

  // ================================================================== development-only
  @Post('dev/mock-fault')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(P.ADMIN)
  mockFault(@Body() dto: MockFaultDto) {
    if (process.env.NODE_ENV === 'production')
      throw new ForbiddenException('Not available in production');
    if (dto.mode === 'NONE') this.faults.clear();
    else this.faults.set(dto);
    return this.faults.current();
  }
}
