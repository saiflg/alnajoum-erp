import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthContext } from '../../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { maskSensitive } from '../runtime/guards';
import { detectLanguage, isLang, say } from '../runtime/language';
import { AgentRunnerService } from './agent-runner.service';
import { PrincipalService } from './principal.service';

const MAX_MESSAGE = 2000;
const CUSTOMER_AGENT = 'customer_service';

/**
 * The customer-facing assistant, its conversation record, and human takeover. The AI never talks over a person:
 * once a staff member takes a conversation, or it is paused (by staff, or by the assistant handing over), the
 * assistant says nothing more until a member of staff resumes it.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly runner: AgentRunnerService,
    private readonly principals: PrincipalService,
  ) {}

  // ------------------------------------------------------------------ customer side
  async customerMessage(
    user: AuthContext,
    input: { conversationId?: string; content: string; language?: string },
  ) {
    const principal = await this.principals.fromAuth(user);
    if (
      principal.kind !== 'CUSTOMER' ||
      !principal.customerId ||
      !principal.companyId
    )
      throw new ForbiddenException(
        'Sign in as a customer to use the assistant',
      );
    const content = input.content.trim();
    if (!content) throw new BadRequestException('Say something first');
    if (content.length > MAX_MESSAGE)
      throw new BadRequestException(
        `Please keep messages under ${MAX_MESSAGE} characters`,
      );

    const customer = await this.prisma.customer.findUnique({
      where: { id: principal.customerId },
      select: { preferredLanguage: true },
    });
    let convo = input.conversationId
      ? await this.prisma.aiConversation.findFirst({
          where: {
            id: input.conversationId,
            customerId: principal.customerId,
            companyId: principal.companyId,
          },
        })
      : null;
    if (input.conversationId && !convo)
      throw new NotFoundException('Conversation not found');
    if (convo?.status === 'CLOSED') convo = null;
    const detected = detectLanguage(content);
    const language = isLang(input.language)
      ? input.language
      : detected !== 'en'
        ? detected
        : (convo?.language ??
          (isLang(customer?.preferredLanguage)
            ? customer!.preferredLanguage!
            : 'en'));
    convo ??= await this.prisma.aiConversation.create({
      data: {
        companyId: principal.companyId,
        customerId: principal.customerId,
        identityId: principal.identityId ?? undefined,
        channel: 'PORTAL',
        language,
      },
    });
    const history = await this.prisma.aiConversationMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    const customerMsg = await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: convo.id,
        role: 'CUSTOMER',
        content: maskSensitive(content),
        language,
      },
    });
    await this.prisma.aiConversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date(), language },
    });

    if (convo.status === 'HUMAN_TAKEN' || convo.status === 'PAUSED') {
      const note = await this.prisma.aiConversationMessage.create({
        data: {
          conversationId: convo.id,
          role: 'SYSTEM',
          content: say('humanActive', language),
          language,
        },
      });
      return {
        conversationId: convo.id,
        status: convo.status,
        messages: [customerMsg, note],
        aiActive: false,
      };
    }

    const result = await this.runner.run({
      agentKey: CUSTOMER_AGENT,
      objective: content,
      principal,
      channel: 'PORTAL',
      language,
      conversationId: convo.id,
      history: history.reverse().map((m) => ({
        role: m.role === 'SYSTEM' ? 'AI' : m.role,
        content: m.content,
      })) as never,
    });
    const aiMsg = await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: convo.id,
        role: 'AI',
        content: result.message,
        language: result.language,
        executionId: result.executionId,
        confidence: result.confidence,
        sources: result.sources.map((label) => ({
          label,
        })) as Prisma.InputJsonValue,
      },
    });
    if (result.handoff) {
      await this.prisma.aiConversation.update({
        where: { id: convo.id },
        data: { status: 'PAUSED', pausedAt: new Date() },
      });
    }
    await this.prisma.aiConversation.update({
      where: { id: convo.id },
      data: { lastMessageAt: new Date() },
    });
    return {
      conversationId: convo.id,
      status: result.handoff ? 'PAUSED' : 'AI_ACTIVE',
      messages: [customerMsg, aiMsg],
      aiActive: !result.handoff,
      executionId: result.executionId,
      approvals: result.approvals,
    };
  }

  async listMine(user: AuthContext) {
    const p = await this.principals.fromAuth(user);
    if (!p.customerId) throw new ForbiddenException('Customers only');
    return this.prisma.aiConversation.findMany({
      where: { customerId: p.customerId, companyId: p.companyId ?? '__none__' },
      orderBy: { lastMessageAt: 'desc' },
      take: 30,
      select: { id: true, status: true, lastMessageAt: true, language: true },
    });
  }

  async getMine(user: AuthContext, id: string) {
    const p = await this.principals.fromAuth(user);
    const convo = await this.prisma.aiConversation.findFirst({
      where: {
        id,
        customerId: p.customerId ?? '__none__',
        companyId: p.companyId ?? '__none__',
      },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    return { ...convo, aiDisclosure: say('aiDisclosure', convo.language) };
  }

  async requestHuman(user: AuthContext, id: string) {
    const p = await this.principals.fromAuth(user);
    const convo = await this.prisma.aiConversation.findFirst({
      where: {
        id,
        customerId: p.customerId ?? '__none__',
        companyId: p.companyId ?? '__none__',
      },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    await this.prisma.aiConversation.update({
      where: { id },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: id,
        role: 'SYSTEM',
        content: say('handoff', convo.language),
        language: convo.language,
      },
    });
    await this.prisma.aiRecommendation.upsert({
      where: {
        companyId_dedupeKey: {
          companyId: convo.companyId,
          dedupeKey: `handoff:${id}`,
        },
      },
      update: { status: 'OPEN' },
      create: {
        companyId: convo.companyId,
        agentKey: CUSTOMER_AGENT,
        kind: 'HUMAN_HANDOFF',
        dedupeKey: `handoff:${id}`,
        title: 'A customer asked for a person',
        reason: 'The customer pressed "talk to a person".',
        evidence: [
          { label: 'Requested by the customer', source: 'AI assistant' },
        ],
        confidence: 'HIGH',
        priorityScore: 45,
        severity: 'HIGH',
        subjectType: 'CUSTOMER',
        subjectId: convo.customerId ?? undefined,
      },
    });
    return { status: 'PAUSED' };
  }

  // ------------------------------------------------------------------ staff side
  private async staffScope(user: AuthContext) {
    const p = await this.principals.fromAuth(user);
    return {
      p,
      tenant: p.isSuperAdmin ? undefined : (p.companyId ?? '__no_tenant__'),
    };
  }

  async listForStaff(
    user: AuthContext,
    status?: 'AI_ACTIVE' | 'PAUSED' | 'HUMAN_TAKEN' | 'CLOSED',
  ) {
    const { p, tenant } = await this.staffScope(user);
    return this.prisma.aiConversation.findMany({
      where: {
        ...(tenant ? { companyId: tenant } : {}),
        ...(status ? { status } : {}),
        ...(p.branchLimited && p.branchId
          ? {
              OR: [
                { customer: { assignedBranchId: p.branchId } },
                { customer: { assignedBranchId: null } },
              ],
            }
          : {}),
      },
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  }

  private async staffConversation(user: AuthContext, id: string) {
    const { p, tenant } = await this.staffScope(user);
    const convo = await this.prisma.aiConversation.findFirst({
      where: {
        id,
        ...(tenant ? { companyId: tenant } : {}),
        ...(p.branchLimited && p.branchId
          ? {
              OR: [
                { customer: { assignedBranchId: p.branchId } },
                { customer: { assignedBranchId: null } },
              ],
            }
          : {}),
      },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    return { convo, p };
  }

  /** What a person needs to correct the AI: the messages, the tools it used, what it proposed, and why it handed over. */
  async inspect(user: AuthContext, id: string) {
    const { convo } = await this.staffConversation(user, id);
    const [messages, executions] = await Promise.all([
      this.prisma.aiConversationMessage.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        take: 300,
      }),
      this.prisma.aiExecution.findMany({
        where: { conversationId: id },
        orderBy: { startedAt: 'asc' },
        take: 50,
        include: {
          steps: {
            orderBy: { seq: 'asc' },
            select: {
              seq: true,
              kind: true,
              toolKey: true,
              risk: true,
              status: true,
              error: true,
            },
          },
          approvals: {
            select: { id: true, toolKey: true, status: true, preview: true },
          },
          agent: { select: { key: true, name: true } },
        },
      }),
    ]);
    return { conversation: convo, messages, executions };
  }

  private async setStatus(
    user: AuthContext,
    id: string,
    status: 'HUMAN_TAKEN' | 'PAUSED' | 'AI_ACTIVE' | 'CLOSED',
    action: string,
    note?: string,
  ) {
    const { convo, p } = await this.staffConversation(user, id);
    await this.prisma.aiConversation.update({
      where: { id },
      data: {
        status,
        assignedStaffId:
          status === 'HUMAN_TAKEN'
            ? (p.staffId ?? undefined)
            : status === 'AI_ACTIVE'
              ? null
              : undefined,
        humanTakenAt: status === 'HUMAN_TAKEN' ? new Date() : undefined,
        pausedAt: status === 'PAUSED' ? new Date() : undefined,
        closedAt: status === 'CLOSED' ? new Date() : undefined,
      },
    });
    await this.audit.record({
      identityId: user.sub,
      companyId: convo.companyId,
      action,
      entityType: 'AiConversation',
      entityId: id,
      reason: note,
    });
    return { status };
  }
  takeOver(user: AuthContext, id: string) {
    return this.setStatus(
      user,
      id,
      'HUMAN_TAKEN',
      'ai.conversation_taken_over',
    );
  }
  pause(user: AuthContext, id: string) {
    return this.setStatus(user, id, 'PAUSED', 'ai.conversation_paused');
  }
  resume(user: AuthContext, id: string) {
    return this.setStatus(user, id, 'AI_ACTIVE', 'ai.conversation_resumed');
  }
  close(user: AuthContext, id: string) {
    return this.setStatus(user, id, 'CLOSED', 'ai.conversation_closed');
  }

  async staffReply(user: AuthContext, id: string, content: string) {
    const { convo, p } = await this.staffConversation(user, id);
    if (!content.trim()) throw new BadRequestException('Write a reply first');
    // Replying implies taking over, so the AI can never talk over the person.
    if (convo.status !== 'HUMAN_TAKEN')
      await this.prisma.aiConversation.update({
        where: { id },
        data: {
          status: 'HUMAN_TAKEN',
          assignedStaffId: p.staffId ?? undefined,
          humanTakenAt: new Date(),
        },
      });
    const msg = await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: id,
        role: 'STAFF',
        content: maskSensitive(content).slice(0, MAX_MESSAGE),
        language: convo.language,
      },
    });
    await this.prisma.aiConversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    });
    return msg;
  }
}
