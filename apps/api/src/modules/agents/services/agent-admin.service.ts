import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AGENT_CATALOG } from '../agent-catalog';
import { AgentConfig, AgentDefinition } from '../agent.types';
import { ToolRegistryService } from '../tools/tool-registry.service';

const hashOf = (d: Pick<AgentDefinition, 'systemPrompt' | 'config'>) =>
  createHash('sha256')
    .update(JSON.stringify([d.systemPrompt, d.config]))
    .digest('hex')
    .slice(0, 16);

export interface LoadedAgent {
  id: string;
  key: string;
  name: string;
  audience: string;
  status: string;
  versionId: string;
  version: number;
  promptVersion: string;
  systemPrompt: string;
  config: AgentConfig;
}

/**
 * Agents and their versions. Behaviour changes only by PUBLISHING a new version (the previous one is retired,
 * kept, and can be rolled back to); nothing edits a published version in place. Every publish is audited with
 * who and why, and every execution records the version and prompt version it ran under.
 */
@Injectable()
export class AgentAdminService implements OnModuleInit {
  private readonly logger = new Logger(AgentAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tools: ToolRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // Local/dev convenience only: production never changes agent behaviour at boot (an operator publishes).
      const report = await this.syncCatalog(
        process.env.NODE_ENV !== 'production',
        null,
      );
      if (report.created.length || report.published.length)
        this.logger.log(
          `AI agents: created ${report.created.length}, new versions ${report.published.length}`,
        );
      if (report.pending.length)
        this.logger.warn(
          `AI agents with a newer built-in definition awaiting publication: ${report.pending.join(', ')}`,
        );
    } catch (err) {
      this.logger.error(`Could not sync AI agents: ${(err as Error).message}`);
    }
  }

  /** Creates missing agents; for existing ones, publishes the catalog definition as a new version if it differs. */
  async syncCatalog(publish: boolean, actorIdentityId: string | null) {
    const created: string[] = [];
    const published: string[] = [];
    const pending: string[] = [];
    for (const def of AGENT_CATALOG) {
      this.validateConfig(def.config, def.audience);
      let agent = await this.prisma.aiAgent.findUnique({
        where: { key: def.key },
        include: { currentVersion: true },
      });
      if (!agent) {
        agent = await this.prisma.aiAgent.create({
          data: {
            key: def.key,
            name: def.name,
            description: def.description,
            purpose: def.purpose,
            audience: def.audience,
          },
          include: { currentVersion: true },
        });
        created.push(def.key);
      }
      const current = agent.currentVersion;
      const currentHash = current
        ? hashOf({
            systemPrompt: current.systemPrompt,
            config: current.config as unknown as AgentConfig,
          })
        : null;
      if (currentHash === hashOf(def)) continue;
      if (!publish && current) {
        pending.push(def.key);
        continue;
      }
      const v = await this.createVersion(
        agent.id,
        def,
        'Built-in definition',
        actorIdentityId,
      );
      await this.publishVersion(v.id, actorIdentityId, 'Built-in definition');
      published.push(def.key);
    }
    return { created, published, pending };
  }

  validateConfig(config: AgentConfig, audience: string): void {
    const errors: string[] = [];
    if (
      !Number.isInteger(config.autonomyLevel) ||
      config.autonomyLevel < 0 ||
      config.autonomyLevel > 5
    )
      errors.push('autonomyLevel must be 0-5');
    for (const t of config.tools) {
      const tool = this.tools.get(t);
      if (!tool) errors.push(`unknown tool "${t}"`);
      else if (!tool.audiences.includes(audience as never))
        errors.push(`tool "${t}" is not available to ${audience} agents`);
    }
    const lim = (k: keyof AgentConfig, max: number) => {
      const v = config[k] as unknown as number;
      if (!Number.isInteger(v) || v < 1 || v > max)
        errors.push(`${k} must be 1-${max}`);
    };
    lim('maxSteps', 25);
    lim('maxToolCalls', 25);
    lim('maxDepth', 4);
    if (
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < 1000 ||
      config.timeoutMs > 120_000
    )
      errors.push('timeoutMs must be 1000-120000');
    if (
      !Number.isInteger(config.maxRetries) ||
      config.maxRetries < 0 ||
      config.maxRetries > 3
    )
      errors.push('maxRetries must be 0-3');
    if (errors.length)
      throw new BadRequestException(
        `Invalid agent configuration: ${errors.join('; ')}`,
      );
  }

  private async createVersion(
    agentId: string,
    def: Pick<AgentDefinition, 'systemPrompt' | 'config' | 'promptVersion'>,
    changeNote: string,
    actorIdentityId: string | null,
  ) {
    const latest = await this.prisma.aiAgentVersion.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
    return this.prisma.aiAgentVersion.create({
      data: {
        agentId,
        version: (latest?.version ?? 0) + 1,
        promptVersion: def.promptVersion,
        systemPrompt: def.systemPrompt,
        config: def.config as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        changeNote,
        createdByIdentityId: actorIdentityId ?? undefined,
      },
    });
  }

  async draftVersion(
    agentKey: string,
    input: {
      systemPrompt?: string;
      promptVersion?: string;
      config?: Partial<AgentConfig>;
      changeNote: string;
    },
    actor: { identityId: string },
  ) {
    const agent = await this.prisma.aiAgent.findUnique({
      where: { key: agentKey },
      include: { currentVersion: true },
    });
    if (!agent?.currentVersion) throw new NotFoundException('Agent not found');
    const cur = agent.currentVersion;
    const config = {
      ...(cur.config as unknown as AgentConfig),
      ...(input.config ?? {}),
    };
    this.validateConfig(config, agent.audience);
    if (!input.changeNote || input.changeNote.length < 5)
      throw new BadRequestException('Say what changed and why (5+ characters)');
    const v = await this.createVersion(
      agent.id,
      {
        systemPrompt: input.systemPrompt ?? cur.systemPrompt,
        promptVersion:
          input.promptVersion ??
          (input.systemPrompt
            ? `p${Date.now().toString(36)}`
            : cur.promptVersion),
        config,
      },
      input.changeNote,
      actor.identityId,
    );
    await this.audit.record({
      identityId: actor.identityId,
      action: 'ai.agent_version_drafted',
      entityType: 'AiAgentVersion',
      entityId: v.id,
      metadata: { agent: agentKey, version: v.version },
    });
    return v;
  }

  /** Publishes a version: the previous published one is retired in the same transaction. */
  async publishVersion(
    versionId: string,
    actorIdentityId: string | null,
    note?: string,
  ) {
    const v = await this.prisma.aiAgentVersion.findUnique({
      where: { id: versionId },
      include: { agent: true },
    });
    if (!v) throw new NotFoundException('Version not found');
    this.validateConfig(v.config as unknown as AgentConfig, v.agent.audience);
    await this.prisma.$transaction(async (tx) => {
      await tx.aiAgentVersion.updateMany({
        where: { agentId: v.agentId, status: 'PUBLISHED', id: { not: v.id } },
        data: { status: 'RETIRED' },
      });
      await tx.aiAgentVersion.update({
        where: { id: v.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      await tx.aiAgent.update({
        where: { id: v.agentId },
        data: { currentVersionId: v.id },
      });
    });
    await this.audit.record({
      identityId: actorIdentityId ?? undefined,
      action: 'ai.agent_version_published',
      entityType: 'AiAgentVersion',
      entityId: v.id,
      reason: note,
      metadata: {
        agent: v.agent.key,
        version: v.version,
        promptVersion: v.promptVersion,
      },
    });
    return { agent: v.agent.key, version: v.version };
  }

  async rollback(
    agentKey: string,
    toVersion: number,
    actor: { identityId: string },
    note: string,
  ) {
    const agent = await this.prisma.aiAgent.findUnique({
      where: { key: agentKey },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    const v = await this.prisma.aiAgentVersion.findUnique({
      where: { agentId_version: { agentId: agent.id, version: toVersion } },
    });
    if (!v) throw new NotFoundException('Version not found');
    return this.publishVersion(v.id, actor.identityId, `Rollback: ${note}`);
  }

  async setAgentStatus(
    agentKey: string,
    status: 'ACTIVE' | 'DISABLED',
    actor: { identityId: string },
    reason: string,
  ) {
    const agent = await this.prisma.aiAgent
      .update({ where: { key: agentKey }, data: { status } })
      .catch(() => null);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.audit.record({
      identityId: actor.identityId,
      action: 'ai.agent_status_changed',
      entityType: 'AiAgent',
      entityId: agent.id,
      reason,
      metadata: { agent: agentKey, status },
    });
    return agent;
  }

  list() {
    return this.prisma.aiAgent.findMany({
      include: {
        currentVersion: {
          select: {
            id: true,
            version: true,
            promptVersion: true,
            publishedAt: true,
            config: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  versions(agentKey: string) {
    return this.prisma.aiAgentVersion.findMany({
      where: { agent: { key: agentKey } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        promptVersion: true,
        status: true,
        changeNote: true,
        publishedAt: true,
        createdAt: true,
        config: true,
        systemPrompt: true,
      },
    });
  }

  async load(agentKey: string): Promise<LoadedAgent> {
    const agent = await this.prisma.aiAgent.findUnique({
      where: { key: agentKey },
      include: { currentVersion: true },
    });
    if (!agent || !agent.currentVersion)
      throw new NotFoundException(`Agent "${agentKey}" is not available`);
    const v = agent.currentVersion;
    return {
      id: agent.id,
      key: agent.key,
      name: agent.name,
      audience: agent.audience,
      status: agent.status,
      versionId: v.id,
      version: v.version,
      promptVersion: v.promptVersion,
      systemPrompt: v.systemPrompt,
      config: v.config as unknown as AgentConfig,
    };
  }
}
