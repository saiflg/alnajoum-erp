import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { CommCampaignScheduler } from './comm-campaign.scheduler';
import { CommCampaignsController } from './comm-campaigns.controller';
import { CommCampaignsService } from './comm-campaigns.service';
import { CommConsentService } from './comm-consent.service';
import { CommContactsController } from './comm-contacts.controller';
import { CommContactsService } from './comm-contacts.service';
import { CommDeliveryService } from './comm-delivery.service';
import { CommEmailWebhookController } from './comm-email-webhook.controller';
import { CommInboundService } from './comm-inbound.service';
import { CommMessageBuilder } from './comm-message.builder';
import { CommOutboundService } from './comm-outbound.service';
import { CommPublicController } from './comm-public.controller';
import { CommPublicService } from './comm-public.service';
import { CommSegmentsController } from './comm-segments.controller';
import { CommSegmentsService } from './comm-segments.service';
import { CommSenderService } from './comm-sender.service';
import { CommSettingsService } from './comm-settings.service';
import { CommTemplatesController } from './comm-templates.controller';
import { CommTemplatesService } from './comm-templates.service';

/**
 * Phase 26 - the Communication Centre: contacts, consent and suppression, the public subscription and preference
 * pages, segments, message templates, WhatsApp and email campaigns with approval and a rate-limited queue, delivery
 * reporting, and inbound opt-out handling.
 *
 * Holding a contact is never permission to market to it. Consent is recorded per channel, enforced by the backend at
 * the moment of sending, and lifted only by a new consent from the person.
 */
@Module({
  imports: [
    ConfigModule,
    AuditModule,
    IntegrationsModule,
    NotificationsModule,
    WhatsAppModule,
  ],
  controllers: [
    CommContactsController,
    CommSegmentsController,
    CommTemplatesController,
    CommCampaignsController,
    CommPublicController,
    CommEmailWebhookController,
  ],
  providers: [
    CommSettingsService,
    CommConsentService,
    CommContactsService,
    CommPublicService,
    CommSegmentsService,
    CommOutboundService,
    CommMessageBuilder,
    CommTemplatesService,
    CommCampaignsService,
    CommDeliveryService,
    CommSenderService,
    CommCampaignScheduler,
    CommInboundService,
  ],
  exports: [
    CommSettingsService,
    CommConsentService,
    CommContactsService,
    CommPublicService,
    CommSegmentsService,
    CommOutboundService,
    CommMessageBuilder,
    CommTemplatesService,
    CommCampaignsService,
    CommDeliveryService,
    CommSenderService,
  ],
})
export class CommunicationModule {}
