import { Body, Controller, Get, Post } from '@nestjs/common';
import { TicketPriority } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { SupportConfigService } from './support-config.service';

@Controller('support/config')
export class SupportConfigController {
  constructor(private readonly configService: SupportConfigService) {}

  /** No permission required — a customer opening a ticket needs this list too, and CUSTOMER holds no permissions at all (see SYSTEM_ROLES.CUSTOMER's empty grant). */
  @Get('categories')
  @RequirePermissions()
  listCategories() {
    return this.configService.listCategories();
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.SUPPORT.CATEGORY_MANAGE)
  createCategory(@Body() body: { name: string }) {
    return this.configService.createCategory(body.name);
  }

  @Get('sla')
  @RequirePermissions(PERMISSIONS.SUPPORT.SLA_MANAGE)
  listSlaRules() {
    return this.configService.listSlaRules();
  }

  @Post('sla')
  @RequirePermissions(PERMISSIONS.SUPPORT.SLA_MANAGE)
  updateSlaRule(
    @Body() body: { priority: TicketPriority; responseMinutes: number },
  ) {
    return this.configService.updateSlaRule(
      body.priority,
      body.responseMinutes,
    );
  }

  @Get('escalation-rules')
  @RequirePermissions(PERMISSIONS.SUPPORT.SLA_MANAGE)
  listEscalationRules() {
    return this.configService.listEscalationRules();
  }

  @Post('escalation-rules')
  @RequirePermissions(PERMISSIONS.SUPPORT.SLA_MANAGE)
  createEscalationRule(
    @Body()
    body: {
      priority: TicketPriority;
      afterMinutes: number;
      notifyRole: string;
      order: number;
    },
  ) {
    return this.configService.createEscalationRule(body);
  }
}
