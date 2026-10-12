import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { CommConsentService } from './comm-consent.service';
import { CommContactsController } from './comm-contacts.controller';
import { CommContactsService } from './comm-contacts.service';
import { CommPublicController } from './comm-public.controller';
import { CommPublicService } from './comm-public.service';
import { CommSegmentsController } from './comm-segments.controller';
import { CommSegmentsService } from './comm-segments.service';
import { CommSettingsService } from './comm-settings.service';

/**
 * Phase 26 - the Communication Centre: contacts, consent and suppression, the public subscription and preference
 * pages, then (in later steps) segments, templates, campaigns, providers, automation and the AI assistant.
 *
 * Holding a contact is never permission to market to it. Consent is recorded per channel, enforced by the backend at
 * the moment of sending, and lifted only by a new consent from the person.
 */
@Module({
  imports: [ConfigModule, AuditModule, NotificationsModule, WhatsAppModule],
  controllers: [
    CommContactsController,
    CommSegmentsController,
    CommPublicController,
  ],
  providers: [
    CommSettingsService,
    CommConsentService,
    CommContactsService,
    CommPublicService,
    CommSegmentsService,
  ],
  exports: [
    CommSettingsService,
    CommConsentService,
    CommContactsService,
    CommPublicService,
    CommSegmentsService,
  ],
})
export class CommunicationModule {}
