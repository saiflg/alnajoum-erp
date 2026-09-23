import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { FlightsModule } from '../flights/flights.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { UsersModule } from '../users/users.module';
import { WhatsAppAdminController } from './whatsapp-admin.controller';
import { WhatsAppAiReplySuggestionService } from './whatsapp-ai-reply-suggestion.service';
import { WhatsAppConsentService } from './whatsapp-consent.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppDevController } from './whatsapp-dev.controller';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { WhatsAppSelfServiceService } from './whatsapp-self-service.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { MetaWhatsAppProviderService } from './providers/meta-whatsapp-provider.service';
import { MockWhatsAppProviderService } from './providers/mock-whatsapp-provider.service';
import { WhatsAppProviderRouter } from './providers/whatsapp-provider.router';

/**
 * Phase 14 — the WhatsApp conversation engine. Deliberately scoped as a
 * first, genuinely-tested increment of the much larger 136-item spec
 * (see PHASE_14.md for the full breakdown of what's built vs. deferred):
 *
 * BUILT: provider abstraction (mock + Meta Cloud API), conversations/
 * messages, inbound webhook processing with idempotency, consent/opt-in
 * (STOP/START), OTP-based account linking, a welcome menu + read-only
 * booking lookup self-service flow, human handoff/takeover, a staff
 * inbox API, and a dev simulator.
 *
 * BUILT (later increment): AI-assisted staff reply drafting —
 * WhatsAppAiReplySuggestionService, reusing Phase 13's AiProviderRouter/
 * AiUsageService (exported from AiModule) — never sends a message
 * itself, only drafts text for a human to review/edit/send.
 *
 * DEFERRED (not attempted yet — each is a real, separately-sized
 * subsystem): WhatsAppTemplate/approval workflow, the automation rule
 * engine, campaigns, flight search/booking THROUGH WhatsApp (only
 * read-only lookup is built — actually booking still requires the
 * customer portal/staff), payment links through WhatsApp,
 * visa/Hajj/Umrah self-service beyond
 * booking lookup, SLA tracking/escalation, business-hours/away-message
 * automation, a real-time staff inbox (no WebSocket/SSE infrastructure
 * exists anywhere in this codebase yet to hook into — spec #126
 * explicitly says not to introduce one unnecessarily), and multi-tenant
 * phone-number routing (the webhook currently attributes every inbound
 * message to the platform's single/oldest company — see
 * WhatsAppWebhookService's own doc comment).
 *
 * Reuses rather than duplicates: Customer.whatsapp (the number field
 * already existed), NotificationPreferencesService.whatsappEnabled (a
 * different, complementary concern to WhatsAppConsent — see its schema
 * comment), CustomerTimelineEvent (CRM history), FlightsService (booking
 * data), and the IntegrationCredential store/admin UI (provider
 * settings) — not a single new parallel mechanism for any of these.
 */
@Module({
  imports: [
    AiModule,
    AuditModule,
    IntegrationsModule,
    UsersModule,
    FlightsModule,
  ],
  controllers: [
    WhatsAppWebhookController,
    WhatsAppAdminController,
    WhatsAppDevController,
  ],
  providers: [
    WhatsAppConsentService,
    WhatsAppOtpService,
    WhatsAppConversationsService,
    WhatsAppSelfServiceService,
    WhatsAppWebhookService,
    WhatsAppAiReplySuggestionService,
    WhatsAppProviderRouter,
    MockWhatsAppProviderService,
    MetaWhatsAppProviderService,
  ],
  exports: [
    WhatsAppConversationsService,
    WhatsAppConsentService,
    WhatsAppProviderRouter,
  ],
})
export class WhatsAppModule {}
