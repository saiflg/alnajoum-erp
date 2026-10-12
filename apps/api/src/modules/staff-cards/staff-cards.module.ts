import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffCardExpiryScheduler } from './staff-card-expiry.scheduler';
import { StaffCardPublicController } from './staff-card-public.controller';
import { StaffCardRenderService } from './staff-card-render.service';
import { StaffCardSettingsService } from './staff-card-settings.service';
import { StaffCardVerificationService } from './staff-card-verification.service';
import { StaffCardsController } from './staff-cards.controller';
import { StaffCardsService } from './staff-cards.service';

/**
 * Phase 26 Module A - staff identification cards: issue, activate, renew, suspend, revoke and replace with a full
 * history; a QR code that opens a public verification page which always asks the live database; a signed-in scanner;
 * print-ready PDF output.
 */
@Module({
  imports: [ConfigModule, AuditModule, NotificationsModule],
  controllers: [StaffCardsController, StaffCardPublicController],
  providers: [
    StaffCardsService,
    StaffCardSettingsService,
    StaffCardRenderService,
    StaffCardVerificationService,
    StaffCardExpiryScheduler,
  ],
  exports: [StaffCardsService, StaffCardVerificationService],
})
export class StaffCardsModule {}
