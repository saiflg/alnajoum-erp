import { Injectable } from '@nestjs/common';
import { WhatsAppMessageDirection } from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { AiUsageService } from '../ai/ai-usage.service';
import { AiProviderRouter } from '../ai/providers/ai-provider.router';
import type { AiCompletionResult } from '../ai/providers/ai-provider.port';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';

const SYSTEM_PROMPT = `You are drafting a WhatsApp reply on behalf of a travel agency staff member, for the staff member to review and edit before sending. Rules:
- Write ONLY the message body the staff member could send as-is or lightly edit. No preamble, no explanation, no quotation marks around it.
- Never invent prices, dates, booking references, policies, or availability. If the customer is asking something you don't have data for in the conversation below, draft a reply that asks a clarifying question or says a colleague will confirm — never guess.
- Never claim an action has already been taken ("I've cancelled that", "refund sent") — you are drafting text, not performing actions.
- Match the tone: professional, warm, concise — a few sentences at most.
- Reply in the customer's language if the conversation indicates one other than English.
Draft the staff member's next reply to the customer's most recent message below.`;

export interface SuggestReplyResult {
  suggestion: string;
  provider: string;
  model: string;
}

/**
 * The "AI-assisted staff replies" item Phase 14 deliberately deferred
 * (see WhatsAppModule's own doc comment) — the next AI capability after
 * Phase 13's analytics assistant. Lives in the WhatsApp module (not the
 * AI module) because it needs WhatsAppConversationsService for
 * tenant-checked conversation context, which is internal to this module;
 * it only reaches into the AI module through AiProviderRouter and
 * AiUsageService, both of which AiModule exports for exactly this kind
 * of reuse (the same way WhatsAppModule exports WhatsAppProviderRouter).
 *
 * Safety model (same constraints Phase 13 was built under): this NEVER
 * sends a WhatsApp message itself — it only returns drafted text for a
 * human to review, edit, and send through the existing
 * WhatsAppConversationsService.sendReply() path. The system prompt
 * explicitly forbids inventing prices/policies/booking data or claiming
 * an action was taken; any real figures the customer needs still have to
 * come from a human checking the actual booking, exactly as before this
 * feature existed.
 */
@Injectable()
export class WhatsAppAiReplySuggestionService {
  constructor(
    private readonly conversationsService: WhatsAppConversationsService,
    private readonly aiProviderRouter: AiProviderRouter,
    private readonly usageService: AiUsageService,
  ) {}

  async suggestReply(
    conversationId: string,
    user: AuthContext,
  ): Promise<SuggestReplyResult> {
    const tenantCompanyId = resolveTenantFilter(user);
    const companyId = user.companyId ?? undefined;
    await this.usageService.enforceDailyLimit(companyId);

    const conversation = await this.conversationsService.get(
      conversationId,
      tenantCompanyId,
    );
    const messages = await this.conversationsService.listMessages(
      conversationId,
      tenantCompanyId,
      10,
    );

    const transcript = [...messages]
      .reverse()
      .filter((m) => !m.isInternalNote && m.content)
      .map((m) =>
        m.direction === WhatsAppMessageDirection.INBOUND
          ? `Customer: ${m.content}`
          : `Staff: ${m.content}`,
      )
      .join('\n');

    const language =
      conversation.language ?? conversation.customer?.preferredLanguage;
    const customerName = conversation.customer
      ? `${conversation.customer.firstName} ${conversation.customer.lastName}`
      : 'an unverified/unlinked customer';
    const lastInbound = [...messages].find(
      (m) => m.direction === WhatsAppMessageDirection.INBOUND && m.content,
    );

    const prompt = [
      `You are replying to ${customerName}.`,
      language ? `Conversation language preference: ${language}.` : null,
      transcript
        ? `Conversation so far:\n${transcript}`
        : 'No prior messages in this conversation.',
      lastInbound
        ? `Customer's most recent message: "${lastInbound.content}"`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    let completion: AiCompletionResult;
    try {
      completion = await this.aiProviderRouter.complete({
        system: SYSTEM_PROMPT,
        prompt,
        temperature: 0.4,
        maxTokens: 300,
      });
    } catch (error) {
      await this.usageService.log({
        identityId: user.sub,
        companyId,
        requestType: 'whatsapp_reply_suggestion',
        provider: 'unknown',
        question: `Reply suggestion for conversation ${conversationId}`,
        status: 'ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await this.usageService.log({
      identityId: user.sub,
      companyId,
      requestType: 'whatsapp_reply_suggestion',
      provider: completion.provider,
      model: completion.model,
      question: `Reply suggestion for conversation ${conversationId}`,
      status: 'MATCHED',
    });

    return {
      suggestion: completion.text.trim(),
      provider: completion.provider,
      model: completion.model,
    };
  }
}
