import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiFeedbackRating } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { maskSensitive } from '../runtime/guards';
import { AiSafetyService } from './safety.service';

/**
 * Human judgement of AI answers: Correct / Incorrect / Partially correct / Unsafe / Needs review. Feedback is
 * stored against the execution within the tenant, shown to administrators, and used to measure quality. It is
 * NEVER used to train a model: nothing here sends customer data anywhere, and deleting a customer removes
 * their conversations and the free-text of any feedback tied to them.
 */
@Injectable()
export class AiFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly safety: AiSafetyService,
  ) {}

  async submit(
    input: {
      executionId?: string;
      messageId?: string;
      rating: AiFeedbackRating;
      note?: string;
    },
    actor: {
      identityId: string;
      companyId: string | null;
      isSuperAdmin: boolean;
      customerId?: string | null;
    },
  ) {
    if (!input.executionId && !input.messageId)
      throw new BadRequestException('Say which answer this is about');
    let executionId = input.executionId;
    if (input.messageId) {
      const msg = await this.prisma.aiConversationMessage.findFirst({
        where: {
          id: input.messageId,
          conversation: {
            ...(actor.isSuperAdmin
              ? {}
              : { companyId: actor.companyId ?? '__none__' }),
            ...(actor.customerId ? { customerId: actor.customerId } : {}),
          },
        },
        select: { executionId: true },
      });
      if (!msg) throw new NotFoundException('That message was not found');
      executionId ??= msg.executionId ?? undefined;
      if (input.rating === 'INCORRECT' || input.rating === 'UNSAFE')
        await this.prisma.aiConversationMessage.update({
          where: { id: input.messageId },
          data: { flagged: true },
        });
    }
    let companyId = actor.companyId;
    if (executionId) {
      const ex = await this.prisma.aiExecution.findFirst({
        where: {
          id: executionId,
          ...(actor.isSuperAdmin
            ? {}
            : { companyId: actor.companyId ?? '__none__' }),
        },
        select: { companyId: true, agent: { select: { key: true } } },
      });
      if (!ex) throw new NotFoundException('That answer was not found');
      companyId = ex.companyId ?? companyId;
      if (input.rating === 'UNSAFE')
        await this.safety.record({
          kind: 'POLICY_VIOLATION',
          companyId,
          executionId,
          agentKey: ex.agent.key,
          identityId: actor.identityId,
          evidence: {
            reportedUnsafeBy: actor.customerId ? 'customer' : 'staff',
          },
        });
    }
    const row = await this.prisma.aiFeedback.create({
      data: {
        companyId: companyId ?? undefined,
        executionId,
        messageId: input.messageId,
        rating: input.rating,
        note: input.note ? maskSensitive(input.note).slice(0, 1500) : undefined,
        ratedByIdentityId: actor.identityId,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: companyId ?? undefined,
      action: 'ai.feedback',
      entityType: 'AiFeedback',
      entityId: row.id,
      metadata: { rating: input.rating, executionId: executionId ?? null },
    });
    return row;
  }

  list(companyId: string | undefined, take = 100) {
    return this.prisma.aiFeedback.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        execution: {
          select: {
            id: true,
            objective: true,
            agent: { select: { key: true, name: true } },
          },
        },
      },
    });
  }
}
