import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { ManualPaymentsController } from './manual-payments.controller';
import { ManualPaymentsService } from './manual-payments.service';

@Module({
  imports: [UsersModule, NotificationsModule, PaymentsModule, AuditModule, IncentivesModule],
  controllers: [ManualPaymentsController],
  providers: [ManualPaymentsService],
  exports: [ManualPaymentsService],
})
export class ManualPaymentsModule {}
