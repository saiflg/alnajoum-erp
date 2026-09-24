import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { FlightsModule } from '../flights/flights.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { WhatsAppAdminController } from './whatsapp-admin.controller';
import { WhatsAppAiReplySuggestionService } from './whatsapp-ai-reply-suggestion.service';
import { WhatsAppConsentService } from './whatsapp-consent.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppDevController } from './whatsapp-dev.controller';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { WhatsAppPaymentLinkService } from './whatsapp-payment-link.service';
import { WhatsAppPaymentNotificationListener } from './whatsapp-payment-notification.listener';
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
 * BUILT (later increment): payment links — WhatsAppPaymentLinkService
 * builds a real checkout link via the existing PaymentsService/
 * PaymentProviderPort (never a bespoke WhatsApp-only checkout), reachable
 * both from customer self-service ("PAY <ref>") and a staff-triggered
 * endpoint. WhatsAppPaymentNotificationListener pushes a WhatsApp
 * confirmation once PaymentsService actually finalizes a payment —
 * listens for an `invoice.payment.succeeded` event rather than being
 * called directly, so PaymentsModule never has to import this module
 * (see app.module.ts's EventEmitterModule.forRoot() comment). Chat text
 * only ever requests a link or relays a confirmation; it never marks
 * anything paid.
 *
 * DEFERRED (not attempted yet — each is a real, separately-sized
 * subsystem): WhatsAppTemplate/approval workflow, the automation rule
 * engine, campaigns, flight search/booking THROUGH WhatsApp (only
 * read-only lookup is built — actually booking still requires the
 * customer portal/staff), visa/Hajj/Umrah self-service beyond
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
    PaymentsModule,
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
    WhatsAppPaymentLinkService,
    WhatsAppPaymentNotificationListener,
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
