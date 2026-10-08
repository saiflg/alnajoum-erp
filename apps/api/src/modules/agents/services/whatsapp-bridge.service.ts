import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AiWhatsAppBridge } from '../../whatsapp/ai-whatsapp-bridge.port';
import { maskSensitive } from '../runtime/guards';
import { detectLanguage, say } from '../runtime/language';
import { AgentRunnerService } from './agent-runner.service';
import { AiControlsService } from './controls.service';
import { PrincipalService } from './principal.service';

/**
 * AI on WhatsApp. It answers ONLY when all of these hold, otherwise the existing deterministic bot is used:
 *  - an administrator has switched the feature `ai.whatsapp` on (it is OFF by default);
 *  - the number belongs to a customer who has completed the one-time-code verification (done by the caller);
 *  - the customer has opted in to WhatsApp messages (consent);
 *  - no person has taken over (the caller returns before reaching here when automation is paused).
 * The first AI message says it is an AI. A hand-over pauses the AI so staff continue the conversation.
 */
@Injectable()
export class AgentWhatsAppBridge implements AiWhatsAppBridge {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AgentRunnerService,
    private readonly controls: AiControlsService,
    private readonly principals: PrincipalService,
  ) {}

  async tryReply(args: {
    companyId: string;
    customerId: string;
    phoneNumber: string;
    text: string;
  }) {
    const controls = await this.controls.resolve(
      args.companyId,
      'customer_service',
    );
    if (
      controls.featureFlags['ai.whatsapp'] !== true ||
      controls.featureFlags['channel.whatsapp'] === false
    )
      return { handled: false };
    const customer = await this.prisma.customer.findFirst({
      where: { id: args.customerId, companyId: args.companyId },
      select: { id: true, identityId: true, whatsappOptIn: true },
    });
    if (!customer || !customer.whatsappOptIn) return { handled: false };

    let convo = await this.prisma.aiConversation.findFirst({
      where: {
        companyId: args.companyId,
        customerId: customer.id,
        channel: 'WHATSAPP',
        status: { not: 'CLOSED' },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    const detected = detectLanguage(args.text);
    const language = detected !== 'en' ? detected : (convo?.language ?? 'en');
    const first = !convo;
    convo ??= await this.prisma.aiConversation.create({
      data: {
        companyId: args.companyId,
        customerId: customer.id,
        identityId: customer.identityId,
        channel: 'WHATSAPP',
        language,
      },
    });
    if (convo.status === 'PAUSED' || convo.status === 'HUMAN_TAKEN')
      return { handled: false };
    await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: convo.id,
        role: 'CUSTOMER',
        content: maskSensitive(args.text),
        language,
      },
    });
    const history = await this.prisma.aiConversationMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    const principal = await this.principals.fromIdentityId(customer.identityId);
    const result = await this.runner.run({
      agentKey: 'customer_service',
      objective: args.text,
      principal,
      channel: 'WHATSAPP',
      language,
      conversationId: convo.id,
      history: history.reverse().map((m) => ({
        role: m.role === 'SYSTEM' ? 'AI' : m.role,
        content: m.content,
      })) as never,
    });
    await this.prisma.aiConversationMessage.create({
      data: {
        conversationId: convo.id,
        role: 'AI',
        content: result.message,
        language: result.language,
        executionId: result.executionId,
        confidence: result.confidence,
      },
    });
    await this.prisma.aiConversation.update({
      where: { id: convo.id },
      data: {
        lastMessageAt: new Date(),
        language,
        ...(result.handoff ? { status: 'PAUSED', pausedAt: new Date() } : {}),
      },
    });
    const message = first
      ? `${say('aiDisclosure', language)}\n\n${result.message}`
      : result.message;
    return { handled: true, message, handoff: result.handoff };
  }
}
