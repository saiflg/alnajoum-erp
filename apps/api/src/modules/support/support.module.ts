import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SupportConfigController } from './support-config.controller';
import { SupportConfigService } from './support-config.service';
import { SupportTicketsAdminController } from './support-tickets-admin.controller';
import { SupportTicketsOwnController } from './support-tickets-own.controller';
import { SupportTicketsService } from './support-tickets.service';

@Module({
  imports: [AuditModule, NotificationsModule, UsersModule, CustomersModule],
  controllers: [
    SupportTicketsOwnController,
    SupportTicketsAdminController,
    SupportConfigController,
  ],
  providers: [SupportTicketsService, SupportConfigService],
  exports: [SupportTicketsService, SupportConfigService],
})
export class SupportModule implements OnModuleInit {
  constructor(private readonly configService: SupportConfigService) {}

  async onModuleInit() {
    await this.configService.ensureDefaults();
  }
}
