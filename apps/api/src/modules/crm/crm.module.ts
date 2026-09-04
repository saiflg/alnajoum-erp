import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';
import { CrmAutomationService } from './crm-automation.service';
import { CrmReportsController } from './crm-reports.controller';
import { CrmReportsService } from './crm-reports.service';
import { Customer360Controller } from './customer-360.controller';
import { Customer360Service } from './customer-360.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AuditModule, NotificationsModule, UsersModule, CustomersModule],
  controllers: [
    LeadsController,
    TasksController,
    Customer360Controller,
    FeedbackController,
    ComplaintsController,
    CampaignsController,
    ReferralsController,
    CrmReportsController,
  ],
  providers: [
    LeadsService,
    TasksService,
    Customer360Service,
    FeedbackService,
    ComplaintsService,
    CampaignsService,
    ReferralsService,
    CrmReportsService,
    CrmAutomationService,
  ],
  exports: [LeadsService, TasksService, ReferralsService],
})
export class CrmModule implements OnModuleInit {
  constructor(private readonly leadsService: LeadsService) {}

  async onModuleInit() {
    await this.leadsService.ensureDefaultStages();
  }
}
