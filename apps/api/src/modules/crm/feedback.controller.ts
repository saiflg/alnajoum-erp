import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { FeedbackService } from './feedback.service';

@Controller('crm/feedback')
export class FeedbackController {
  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly customersService: CustomersService,
    private readonly usersService: UsersService,
  ) {}

  @Post('me')
  async createOwn(
    @CurrentUser() user: AuthContext,
    @Body()
    body: {
      serviceType: string;
      sourceType?: string;
      sourceId?: string;
      rating: number;
      staffRating?: number;
      comment?: string;
      staffId?: string;
    },
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.feedbackService.create(customerId, body);
  }

  @Get('me')
  async listOwn(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.feedbackService.listForCustomer(customerId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.FEEDBACK_VIEW)
  listAll(
    @Query('isApproved') isApproved?: string,
    @Query('serviceType') serviceType?: string,
  ) {
    return this.feedbackService.listAll({
      isApproved: isApproved === undefined ? undefined : isApproved === 'true',
      serviceType,
    });
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.CRM.FEEDBACK_APPROVE)
  async approve(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.feedbackService.approve(id, staffId ?? 'system');
  }
}
