import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkflowDefinition, WorkflowVersion } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnalyticsScope,
  AnalyticsScopeService,
} from '../analytics/analytics-scope.service';
import { AuditService } from '../audit/audit.service';
import { ActionRegistryService } from './actions/action-registry.service';
import {
  fieldsFor,
  TRIGGER_CATALOG,
  UNAVAILABLE_TRIGGERS,
} from './engine/catalog';
import { ConditionError, evaluateCondition } from './engine/conditions';
import { WorkflowGraph } from './engine/graph';
import {
  canTransition,
  isRetryableReason,
  isTerminal,
  WorkflowStatus,
} from './engine/lifecycle';
import { LIMITS } from './engine/conditions';
import { redact } from './engine/redact';
import { lastWindowStart, ScheduleConfig } from './engine/schedule';
import { simulateWorkflow } from './engine/simulate';
import { GRAPH_LIMITS } from './engine/graph';
import {
  CreateWorkflowDto,
  DeadLetterQueryDto,
  ExecutionQueryDto,
  SampleRunDto,
  SaveVersionDto,
  WorkflowListQueryDto,
} from './dto/workflow.dto';
import {
  validateWorkflowVersion,
  ValidationReport,
} from './workflow-validation';
import { WorkflowExecutorService } from './workflow-executor.service';

const MAX_TEST_PASSES = 10;

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ActionRegistryService,
    private readonly executor: WorkflowExecutorService,
    private readonly scopes: AnalyticsScopeService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- scoping

  /** The caller's own company, for anything that CREATES or CHANGES automation. The super admin has no single tenant to act for. */
  private ownTenant(user: AuthContext): string {
    const t = resolveTenantFilter(user);
    if (t === undefined)
      throw new BadRequestException(
        'The super admin has no single company here — sign in as a company administrator to manage workflows.',
      );
    if (t === '__no_tenant__')
      throw new ForbiddenException('Your account is not attached to a company');
    return t;
  }

  /** For reads: the super admin sees every company; everyone else only their own (and, if branch-locked, their branch). */
  private async readScope(user: AuthContext): Promise<AnalyticsScope> {
    return this.scopes.resolve(user);
  }

  private defWhere(scope: AnalyticsScope): Prisma.WorkflowDefinitionWhereInput {
    return {
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
      ...(scope.branchLocked && scope.branchId
        ? { OR: [{ branchId: null }, { branchId: scope.branchId }] }
        : {}),
    };
  }

  private execWhere(scope: AnalyticsScope): Prisma.WorkflowExecutionWhereInput {
    return {
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
      ...(scope.branchLocked && scope.branchId
        ? { branchId: scope.branchId }
        : {}),
    };
  }

  private async load(
    user: AuthContext,
    id: string,
  ): Promise<WorkflowDefinition> {
    const scope = await this.readScope(user);
    const def = await this.prisma.workflowDefinition.findFirst({
      where: { id, ...this.defWhere(scope) },
    });
    if (!def) throw new NotFoundException('Workflow not found'); // another company's id looks exactly like a missing one
    return def;
  }

  private async loadForChange(
    user: AuthContext,
    id: string,
  ): Promise<WorkflowDefinition> {
    const companyId = this.ownTenant(user);
    const def = await this.prisma.workflowDefinition.findFirst({
      where: { id, companyId },
    });
    if (!def) throw new NotFoundException('Workflow not found');
    return def;
  }

  private versionRow(
    workflowId: string,
    versionNo: number | undefined,
    latest: number,
  ): Promise<WorkflowVersion | null> {
    return this.prisma.workflowVersion.findUnique({
      where: {
        workflowId_version: { workflowId, version: versionNo ?? latest },
      },
    });
  }

  // -------------------------------------------------------------- validation

  private validate(
    def: Pick<WorkflowDefinition, 'id'>,
    v: Pick<WorkflowVersion, 'graph' | 'retryPolicy'>,
    user: AuthContext | null,
  ): ValidationReport {
    return validateWorkflowVersion(
      { graph: v.graph, retryPolicy: v.retryPolicy },
      {
        getAction: (k) => this.registry.get(k),
        knownActionKeys: this.registry.keys(),
        authorPermissions: user ? user.permissions : null,
        workflowId: def.id,
      },
    );
  }

  // ------------------------------------------------------------------- reads

  async list(user: AuthContext, q: WorkflowListQueryDto) {
    const scope = await this.readScope(user);
    const rows = await this.prisma.workflowDefinition.findMany({
      where: {
        ...this.defWhere(scope),
        ...(q.status ? { status: q.status as WorkflowStatus } : {}),
        ...(q.search
          ? { name: { contains: q.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        companyId: true,
        name: true,
        description: true,
        status: true,
        isDemo: true,
        triggerEvent: true,
        activeVersionId: true,
        latestVersion: true,
        branchId: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { executions: true } },
      },
    });
    return rows;
  }

  async get(user: AuthContext, id: string) {
    const def = await this.load(user, id);
    const versions = await this.prisma.workflowVersion.findMany({
      where: { workflowId: id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        isLocked: true,
        lockedAt: true,
        changeReason: true,
        createdAt: true,
        createdByIdentityId: true,
        validation: true,
        graph: true,
        retryPolicy: true,
      },
    });
    return { ...def, versions };
  }

  catalog() {
    return {
      triggers: TRIGGER_CATALOG,
      dynamicTriggers: [
        {
          prefix: 'schedule.',
          description:
            'A time-based trigger: set a schedule on the Trigger step instead of an event.',
        },
        {
          prefix: 'custom.',
          description:
            'Started by another workflow using the "event.emit" action.',
        },
      ],
      unavailableTriggers: UNAVAILABLE_TRIGGERS,
      actions: this.registry.list(),
      nodeTypes: [
        'TRIGGER',
        'CONDITION',
        'ACTION',
        'APPROVAL',
        'DELAY',
        'WAIT',
        'ESCALATION',
        'END',
      ],
      limits: { condition: LIMITS, graph: GRAPH_LIMITS },
      fieldsByTrigger: Object.fromEntries(
        TRIGGER_CATALOG.map((t) => [t.type, [...fieldsFor(t.type)]]),
      ),
    };
  }

  // ------------------------------------------------------------------ writes

  async create(user: AuthContext, dto: CreateWorkflowDto) {
    const companyId = this.ownTenant(user);
    if (dto.branchId) {
      const b = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!b) throw new NotFoundException('Branch not found');
    }
    const id = `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const report = this.validate(
      { id },
      {
        graph: dto.graph as Prisma.JsonValue,
        retryPolicy: (dto.retryPolicy ?? null) as Prisma.JsonValue,
      },
      user,
    );
    try {
      const def = await this.prisma.workflowDefinition.create({
        data: {
          id,
          companyId,
          branchId: dto.branchId,
          name: dto.name.trim(),
          description: dto.description,
          ownerIdentityId: user.sub,
          createdByIdentityId: user.sub,
          updatedByIdentityId: user.sub,
          versions: {
            create: {
              version: 1,
              graph: dto.graph as Prisma.InputJsonValue,
              retryPolicy: (dto.retryPolicy ?? undefined) as
                Prisma.InputJsonValue | undefined,
              validation: report as unknown as Prisma.InputJsonValue,
              createdByIdentityId: user.sub,
              changeReason: 'Initial version',
            },
          },
        },
      });
      await this.audit.record({
        identityId: user.sub,
        action: 'workflow.created',
        entityType: 'WorkflowDefinition',
        entityId: def.id,
        companyId,
        newValue: { name: def.name, status: def.status },
      });
      return { ...def, validation: report };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('A workflow with that name already exists');
      throw e;
    }
  }

  /**
   * Edit the latest version while it is a draft; once it has been tested or activated it is
   * LOCKED, and the change becomes the next version. A running execution keeps the version it
   * started under either way.
   */
  async saveVersion(user: AuthContext, id: string, dto: SaveVersionDto) {
    const def = await this.loadForChange(user, id);
    if (def.status === 'ARCHIVED')
      throw new ConflictException('An archived workflow cannot be changed');
    const latest = await this.versionRow(id, undefined, def.latestVersion);
    if (!latest) throw new NotFoundException('Workflow version not found');
    const report = this.validate(
      def,
      {
        graph: dto.graph as Prisma.JsonValue,
        retryPolicy: (dto.retryPolicy ??
          latest.retryPolicy) as Prisma.JsonValue,
      },
      user,
    );
    const meta = {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      updatedByIdentityId: user.sub,
    };

    if (!latest.isLocked) {
      await this.prisma.$transaction([
        this.prisma.workflowVersion.update({
          where: { id: latest.id },
          data: {
            graph: dto.graph as Prisma.InputJsonValue,
            retryPolicy: (dto.retryPolicy ?? undefined) as
              Prisma.InputJsonValue | undefined,
            validation: report as unknown as Prisma.InputJsonValue,
            ...(dto.changeReason ? { changeReason: dto.changeReason } : {}),
          },
        }),
        this.prisma.workflowDefinition.update({ where: { id }, data: meta }),
      ]);
      await this.audit.record({
        identityId: user.sub,
        action: 'workflow.draft_saved',
        entityType: 'WorkflowDefinition',
        entityId: id,
        companyId: def.companyId,
        metadata: { version: latest.version },
      });
      return {
        version: latest.version,
        createdNewVersion: false,
        validation: report,
      };
    }

    if (!dto.changeReason || dto.changeReason.trim().length < 5)
      throw new BadRequestException(
        'This version is locked (it has been tested or activated). Say why you are changing it — that creates the next version.',
      );
    // Optimistic concurrency: only one editor can claim "latestVersion + 1".
    const next = latest.version + 1;
    const claimed = await this.prisma.workflowDefinition.updateMany({
      where: { id, latestVersion: latest.version },
      data: { latestVersion: next, ...meta },
    });
    if (claimed.count !== 1)
      throw new ConflictException(
        'Someone else just changed this workflow. Reload and try again.',
      );
    await this.prisma.workflowVersion.create({
      data: {
        workflowId: id,
        version: next,
        graph: dto.graph as Prisma.InputJsonValue,
        retryPolicy: (dto.retryPolicy ?? latest.retryPolicy ?? undefined) as
          Prisma.InputJsonValue | undefined,
        validation: report as unknown as Prisma.InputJsonValue,
        createdByIdentityId: user.sub,
        changeReason: dto.changeReason.trim(),
      },
    });
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.version_created',
      entityType: 'WorkflowDefinition',
      entityId: id,
      companyId: def.companyId,
      reason: dto.changeReason.trim(),
      previousValue: { version: latest.version },
      newValue: { version: next },
    });
    return { version: next, createdNewVersion: true, validation: report };
  }

  async validateVersion(user: AuthContext, id: string, versionNo?: number) {
    const def = await this.load(user, id);
    const v = await this.versionRow(id, versionNo, def.latestVersion);
    if (!v) throw new NotFoundException('Workflow version not found');
    return { version: v.version, ...this.validate(def, v, user) };
  }

  // ---------------------------------------------------------- test / dry run

  private contextFor(
    triggerEvent: string,
    dto: SampleRunDto,
  ): Record<string, unknown> {
    const { event: _e, steps: _s, workflow: _w, ...payload } = dto.payload;
    return {
      ...(redact(payload) as Record<string, unknown>),
      event: {
        id: 'sample',
        type: triggerEvent,
        entityType: null,
        entityId: dto.entityId ?? null,
        occurredAt: new Date().toISOString(),
        correlationId: 'sample',
      },
      steps: {},
    };
  }

  /** What WOULD happen — no execution record, no side effect of any kind. */
  async dryRun(user: AuthContext, id: string, dto: SampleRunDto) {
    const def = await this.load(user, id);
    const v = await this.versionRow(id, dto.versionNo, def.latestVersion);
    if (!v) throw new NotFoundException('Workflow version not found');
    const report = this.validate(def, v, null);
    const graph = v.graph as unknown as WorkflowGraph;
    const simulation =
      report.ok || report.errors.every((e) => e.code === 'MISSING_PERMISSION')
        ? simulateWorkflow(
            graph,
            this.contextFor(report.triggerEvent ?? 'sample.event', dto),
            {
              actions: this.registry.info(),
              assumeApproval: dto.assumeApproval,
            },
          )
        : null;
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.dry_run',
      entityType: 'WorkflowDefinition',
      entityId: id,
      companyId: def.companyId,
      metadata: { version: v.version },
    });
    return { version: v.version, validation: report, simulation };
  }

  /**
   * Test mode: run the workflow for real through the engine, but every action is a MOCK —
   * nothing is sent, created or charged, approvals are assumed granted and waits/delays are
   * skipped. The execution is recorded (type TEST) so its full trace can be inspected.
   * Testing locks the version, so what you tested is exactly what you can later activate.
   */
  async test(user: AuthContext, id: string, dto: SampleRunDto) {
    const def = await this.loadForChange(user, id);
    const v = await this.versionRow(id, dto.versionNo, def.latestVersion);
    if (!v) throw new NotFoundException('Workflow version not found');
    const report = this.validate(def, v, user);
    if (!report.ok || !report.triggerEvent)
      throw new UnprocessableEntityException({
        message: 'The workflow is not valid yet, so it cannot be tested',
        validation: report,
      });

    const graph = v.graph as unknown as WorkflowGraph;
    const trigger = graph.nodes.find((n) => n.type === 'TRIGGER');
    const context = this.contextFor(report.triggerEvent, dto);
    const cond = (trigger?.config as { condition?: unknown } | undefined)
      ?.condition;
    if (cond) {
      try {
        if (!evaluateCondition(cond as never, context).result)
          return {
            started: false,
            reason: 'The trigger condition is not met for this sample',
            validation: report,
          };
      } catch (e) {
        if (e instanceof ConditionError)
          throw new UnprocessableEntityException(e.message);
        throw e;
      }
    }

    await this.prisma.workflowVersion.updateMany({
      where: { id: v.id, isLocked: false },
      data: { isLocked: true, lockedAt: new Date() },
    });
    if (def.status === 'DRAFT')
      await this.prisma.workflowDefinition.update({
        where: { id },
        data: { status: 'TESTING', updatedByIdentityId: user.sub },
      });

    const correlationId = randomUUID();
    const ex = await this.prisma.workflowExecution.create({
      data: {
        workflowId: id,
        versionId: v.id,
        versionNo: v.version,
        companyId: def.companyId,
        branchId: def.branchId,
        executionKey: `test:${randomUUID()}`,
        mode: 'TEST',
        status: 'RUNNING',
        context: context as Prisma.InputJsonValue,
        chain: { workflowChain: [id], eventChain: [] },
        correlationId,
        entityId: dto.entityId,
        currentNodeId: trigger?.id,
        startedByIdentityId: user.sub,
      },
    });
    for (let pass = 0; pass < MAX_TEST_PASSES; pass++) {
      await this.executor.advance(ex.id);
      const cur = await this.prisma.workflowExecution.findUnique({
        where: { id: ex.id },
        select: { status: true },
      });
      if (!cur || isTerminal(cur.status)) break;
      await this.prisma.workflowExecution.updateMany({
        where: { id: ex.id, status: 'WAITING' },
        data: { nextRunAt: new Date() },
      });
    }
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.tested',
      entityType: 'WorkflowExecution',
      entityId: ex.id,
      companyId: def.companyId,
      metadata: { workflowId: id, version: v.version },
    });
    return { started: true, execution: await this.getExecution(user, ex.id) };
  }

  // --------------------------------------------------------------- lifecycle

  async activate(user: AuthContext, id: string, versionNo?: number) {
    const def = await this.loadForChange(user, id);
    if (!canTransition(def.status, 'ACTIVE'))
      throw new ConflictException(
        `A ${def.status.toLowerCase()} workflow cannot be activated`,
      );
    const v = await this.versionRow(id, versionNo, def.latestVersion);
    if (!v) throw new NotFoundException('Workflow version not found');
    const report = this.validate(def, v, user);
    if (!report.ok || !report.triggerEvent)
      throw new UnprocessableEntityException({
        message: 'The workflow is not valid, so it cannot be activated',
        validation: report,
      });

    const graph = v.graph as unknown as WorkflowGraph;
    const schedule = (
      graph.nodes.find((n) => n.type === 'TRIGGER')?.config as
        { schedule?: ScheduleConfig } | undefined
    )?.schedule;
    await this.prisma.$transaction([
      this.prisma.workflowVersion.update({
        where: { id: v.id },
        data: {
          isLocked: true,
          lockedAt: v.lockedAt ?? new Date(),
          validation: report as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.workflowDefinition.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          activeVersionId: v.id,
          triggerEvent: report.triggerEvent,
          updatedByIdentityId: user.sub,
          // A schedule starts from the NEXT window — activating must not fire a window that already passed.
          ...(schedule
            ? { scheduleLastFiredAt: lastWindowStart(schedule, new Date()) }
            : {}),
        },
      }),
    ]);
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.activated',
      entityType: 'WorkflowDefinition',
      entityId: id,
      companyId: def.companyId,
      previousValue: {
        status: def.status,
        activeVersionId: def.activeVersionId,
      },
      newValue: { status: 'ACTIVE', activeVersionId: v.id, version: v.version },
    });
    return {
      id,
      status: 'ACTIVE',
      activeVersion: v.version,
      triggerEvent: report.triggerEvent,
    };
  }

  async setStatus(
    user: AuthContext,
    id: string,
    to: Extract<WorkflowStatus, 'PAUSED' | 'DISABLED' | 'ARCHIVED' | 'ACTIVE'>,
    reason?: string,
  ) {
    const def = await this.loadForChange(user, id);
    if (to === 'ACTIVE') {
      // Resume = re-activate the version that was active, after re-checking it is still valid.
      if (def.status !== 'PAUSED' && def.status !== 'DISABLED')
        throw new ConflictException(
          'Only a paused or disabled workflow can be resumed',
        );
      const v = def.activeVersionId
        ? await this.prisma.workflowVersion.findUnique({
            where: { id: def.activeVersionId },
          })
        : null;
      if (!v)
        throw new ConflictException(
          'This workflow has no activated version to resume',
        );
      return this.activate(user, id, v.version);
    }
    if (!canTransition(def.status, to))
      throw new ConflictException(
        `A ${def.status.toLowerCase()} workflow cannot be ${to.toLowerCase()}`,
      );
    await this.prisma.workflowDefinition.update({
      where: { id },
      data: { status: to, updatedByIdentityId: user.sub },
    });
    await this.audit.record({
      identityId: user.sub,
      action: `workflow.${to.toLowerCase()}`,
      entityType: 'WorkflowDefinition',
      entityId: id,
      companyId: def.companyId,
      reason,
      previousValue: { status: def.status },
      newValue: { status: to },
    });
    return { id, status: to };
  }

  // -------------------------------------------------------------- executions

  async listExecutions(user: AuthContext, q: ExecutionQueryDto) {
    const scope = await this.readScope(user);
    const search = q.search?.trim();
    const where: Prisma.WorkflowExecutionWhereInput = {
      ...this.execWhere(scope),
      ...(q.workflowId ? { workflowId: q.workflowId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.branchId && !scope.branchLocked ? { branchId: q.branchId } : {}),
      ...(search
        ? {
            OR: [
              { id: search },
              { entityId: search },
              { correlationId: search },
              { eventId: search },
              { workflow: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.workflowExecution.count({ where }),
      this.prisma.workflowExecution.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: q.limit ?? 50,
        skip: q.offset ?? 0,
        select: {
          id: true,
          workflowId: true,
          versionNo: true,
          mode: true,
          status: true,
          currentNodeId: true,
          entityType: true,
          entityId: true,
          correlationId: true,
          startedAt: true,
          finishedAt: true,
          error: true,
          nextRunAt: true,
          workflow: { select: { name: true } },
        },
      }),
    ]);
    return { total, items };
  }

  async getExecution(user: AuthContext, id: string) {
    const scope = await this.readScope(user);
    const ex = await this.prisma.workflowExecution.findFirst({
      where: { id, ...this.execWhere(scope) },
      include: {
        steps: { orderBy: { startedAt: 'asc' } },
        deadLetters: { orderBy: { createdAt: 'desc' } },
        workflow: { select: { id: true, name: true } },
      },
    });
    if (!ex) throw new NotFoundException('Execution not found');
    const event = ex.eventId
      ? await this.prisma.workflowEvent.findFirst({
          where: { id: ex.eventId, companyId: ex.companyId },
          select: {
            id: true,
            type: true,
            source: true,
            occurredAt: true,
            entityType: true,
            entityId: true,
            correlationId: true,
          },
        })
      : null;
    return { ...ex, event };
  }

  async cancelExecution(user: AuthContext, id: string, reason: string) {
    const companyId = this.ownTenant(user);
    const ex = await this.prisma.workflowExecution.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, branchId: true },
    });
    if (!ex) throw new NotFoundException('Execution not found');
    if (isTerminal(ex.status) && ex.status !== 'DEAD_LETTERED')
      throw new ConflictException(
        `This execution is already ${ex.status.toLowerCase()}`,
      );
    await this.prisma.$transaction([
      this.prisma.workflowExecution.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          nextRunAt: null,
          finishedAt: new Date(),
          error: `Cancelled: ${reason}`,
        },
      }),
      this.prisma.workflowDeadLetter.updateMany({
        where: { executionId: id, status: 'OPEN' },
        data: {
          status: 'CANCELLED',
          resolvedByIdentityId: user.sub,
          resolvedAt: new Date(),
          resolutionNote: reason,
        },
      }),
    ]);
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.execution_cancelled',
      entityType: 'WorkflowExecution',
      entityId: id,
      companyId,
      reason,
      previousValue: { status: ex.status },
    });
    return { id, status: 'CANCELLED' };
  }

  // ------------------------------------------------------------ dead letters

  async listDeadLetters(user: AuthContext, q: DeadLetterQueryDto) {
    const scope = await this.readScope(user);
    return this.prisma.workflowDeadLetter.findMany({
      where: {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.branchLocked && scope.branchId
          ? { execution: { branchId: scope.branchId } }
          : {}),
        status: (q.status ?? 'OPEN') as never,
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit ?? 50,
      include: {
        execution: {
          select: {
            id: true,
            workflowId: true,
            entityType: true,
            entityId: true,
            workflow: { select: { name: true } },
          },
        },
      },
    });
  }

  private async loadDeadLetter(user: AuthContext, id: string) {
    const companyId = this.ownTenant(user);
    const dl = await this.prisma.workflowDeadLetter.findFirst({
      where: { id, companyId },
      include: { execution: true },
    });
    if (!dl) throw new NotFoundException('Dead-letter entry not found');
    if (dl.status !== 'OPEN')
      throw new ConflictException(
        `This entry is already ${dl.status.toLowerCase()}`,
      );
    return dl;
  }

  async retryDeadLetter(
    user: AuthContext,
    id: string,
    confirmFinancial = false,
  ) {
    const dl = await this.loadDeadLetter(user, id);
    if (!isRetryableReason(dl.reason))
      throw new ConflictException(
        `This failure (${dl.reason}) is a problem with the workflow itself; retrying would fail the same way. Fix the workflow, or cancel/resolve this entry.`,
      );
    if (dl.execution.status !== 'DEAD_LETTERED')
      throw new ConflictException('The execution is no longer parked');

    // A step that moves money needs an explicit, audited confirmation to run again.
    if (dl.nodeId) {
      const version = await this.prisma.workflowVersion.findUnique({
        where: { id: dl.execution.versionId },
        select: { graph: true },
      });
      const node = (
        version?.graph as unknown as WorkflowGraph | undefined
      )?.nodes.find((n) => n.id === dl.nodeId);
      const action =
        node?.type === 'ACTION'
          ? this.registry.get(
              String((node.config as { action?: unknown } | undefined)?.action),
            )
          : undefined;
      if (action?.sideEffect === 'FINANCIAL' && !confirmFinancial)
        throw new BadRequestException(
          'This step moves money. Confirm you have checked it did not already complete, then retry with confirmFinancial.',
        );
    }

    await this.prisma.$transaction([
      ...(dl.nodeId
        ? [
            this.prisma.workflowExecutionStep.updateMany({
              where: {
                executionId: dl.executionId,
                nodeId: dl.nodeId,
                status: 'FAILED',
              },
              data: {
                status: 'RETRYING',
                attempts: 0,
                error: null,
                finishedAt: null,
              },
            }),
          ]
        : []),
      this.prisma.workflowExecution.update({
        where: { id: dl.executionId },
        data: {
          status: 'WAITING',
          nextRunAt: new Date(),
          error: null,
          finishedAt: null,
          currentNodeId: dl.nodeId ?? dl.execution.currentNodeId,
        },
      }),
      this.prisma.workflowDeadLetter.update({
        where: { id },
        data: {
          status: 'RETRIED',
          retryCount: { increment: 1 },
          resolvedByIdentityId: user.sub,
          resolvedAt: new Date(),
        },
      }),
    ]);
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.execution_retried',
      entityType: 'WorkflowExecution',
      entityId: dl.executionId,
      companyId: dl.companyId,
      metadata: { deadLetterId: id, nodeId: dl.nodeId, confirmFinancial },
    });
    await this.executor.advance(dl.executionId);
    return this.getExecution(user, dl.executionId);
  }

  async cancelDeadLetter(user: AuthContext, id: string, reason: string) {
    const dl = await this.loadDeadLetter(user, id);
    await this.cancelExecution(user, dl.executionId, reason);
    return { id, status: 'CANCELLED' };
  }

  async resolveDeadLetter(user: AuthContext, id: string, note: string) {
    const dl = await this.loadDeadLetter(user, id);
    await this.prisma.workflowDeadLetter.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedByIdentityId: user.sub,
        resolvedAt: new Date(),
        resolutionNote: note,
      },
    });
    await this.audit.record({
      identityId: user.sub,
      action: 'workflow.dead_letter_resolved',
      entityType: 'WorkflowExecution',
      entityId: dl.executionId,
      companyId: dl.companyId,
      reason: note,
      metadata: { deadLetterId: id },
    });
    return { id, status: 'RESOLVED' };
  }

  // ---------------------------------------------------------- events/metrics

  async listEvents(user: AuthContext, limit = 50) {
    const scope = await this.readScope(user);
    return this.prisma.workflowEvent.findMany({
      where: {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.branchLocked && scope.branchId
          ? { branchId: scope.branchId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        type: true,
        source: true,
        status: true,
        entityType: true,
        entityId: true,
        correlationId: true,
        occurredAt: true,
        error: true,
      },
    });
  }

  async metrics(user: AuthContext) {
    const scope = await this.readScope(user);
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const since7d = new Date(Date.now() - 7 * 24 * 3600_000);
    const exWhere = this.execWhere(scope);
    const company = scope.companyId ? { companyId: scope.companyId } : {};
    const [
      byStatus24h,
      byStatus7d,
      workflows,
      openDead,
      pendingEvents,
      failedEvents,
      dueNow,
      timing,
      topFailing,
    ] = await Promise.all([
      this.prisma.workflowExecution.groupBy({
        by: ['status'],
        where: { ...exWhere, mode: 'LIVE', startedAt: { gte: since24h } },
        _count: { _all: true },
      }),
      this.prisma.workflowExecution.groupBy({
        by: ['status'],
        where: { ...exWhere, mode: 'LIVE', startedAt: { gte: since7d } },
        _count: { _all: true },
      }),
      this.prisma.workflowDefinition.groupBy({
        by: ['status'],
        where: this.defWhere(scope),
        _count: { _all: true },
      }),
      this.prisma.workflowDeadLetter.count({
        where: { ...company, status: 'OPEN' },
      }),
      this.prisma.workflowEvent.count({
        where: { ...company, status: 'PENDING' },
      }),
      this.prisma.workflowEvent.count({
        where: { ...company, status: 'FAILED' },
      }),
      this.prisma.workflowExecution.count({
        where: {
          ...exWhere,
          status: { in: ['RUNNING', 'WAITING'] },
          nextRunAt: { lte: new Date() },
        },
      }),
      this.prisma.$queryRaw<{ avg_ms: number | null }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000) AS avg_ms
          FROM "workflow_executions"
         WHERE "status" = 'COMPLETED' AND "mode" = 'LIVE' AND "startedAt" >= ${since7d}
           ${scope.companyId ? Prisma.sql`AND "companyId" = ${scope.companyId}` : Prisma.empty}
           ${scope.branchLocked && scope.branchId ? Prisma.sql`AND "branchId" = ${scope.branchId}` : Prisma.empty}`,
      this.prisma.workflowDeadLetter.groupBy({
        by: ['workflowId'],
        where: { ...company, createdAt: { gte: since7d } },
        _count: { _all: true },
        orderBy: { _count: { workflowId: 'desc' } },
        take: 5,
      }),
    ]);
    const count = (
      rows: { status: string; _count: { _all: number } }[],
      s: string,
    ) => rows.find((r) => r.status === s)?._count._all ?? 0;
    const rate = (rows: { status: string; _count: { _all: number } }[]) => {
      const ok = count(rows, 'COMPLETED');
      const bad = count(rows, 'FAILED') + count(rows, 'DEAD_LETTERED');
      return ok + bad === 0
        ? null
        : Math.round((ok / (ok + bad)) * 10_000) / 100;
    };
    return {
      generatedAt: new Date().toISOString(),
      workflows: Object.fromEntries(
        workflows.map((w) => [w.status, w._count._all]),
      ),
      executions: {
        last24h: Object.fromEntries(
          byStatus24h.map((r) => [r.status, r._count._all]),
        ),
        last7d: Object.fromEntries(
          byStatus7d.map((r) => [r.status, r._count._all]),
        ),
      },
      successRatePercent: {
        last24h: rate(byStatus24h),
        last7d: rate(byStatus7d),
      },
      failureRatePercent: {
        last24h:
          rate(byStatus24h) === null
            ? null
            : Math.round((100 - (rate(byStatus24h) as number)) * 100) / 100,
        last7d:
          rate(byStatus7d) === null
            ? null
            : Math.round((100 - (rate(byStatus7d) as number)) * 100) / 100,
      },
      avgCompletionSeconds:
        timing[0]?.avg_ms == null
          ? null
          : Math.round(Number(timing[0].avg_ms) / 10) / 100,
      deadLettersOpen: openDead,
      queue: {
        dueNow,
        eventsPending: pendingEvents,
        eventsFailed: failedEvents,
      },
      topFailingWorkflows: topFailing.map((t) => ({
        workflowId: t.workflowId,
        deadLetters: t._count._all,
      })),
    };
  }
}
