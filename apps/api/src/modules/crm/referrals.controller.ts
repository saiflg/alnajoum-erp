import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReferralStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { ReferralsService } from './referrals.service';

@Controller('crm/referrals')
export class ReferralsController {
  constructor(
    private readonly referralsService: ReferralsService,
    private readonly customersService: CustomersService,
  ) {}

  @Get('me/code')
  async getMyCode(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.referralsService.getOrCreateCode(customerId);
  }

  @Get('me')
  async listMine(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.referralsService.listForCustomer(customerId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.REFERRAL_MANAGE)
  listAll(@Query('status') status?: ReferralStatus) {
    return this.referralsService.listAll({ status });
  }

  @Post(':id/qualify')
  @RequirePermissions(PERMISSIONS.CRM.REFERRAL_MANAGE)
  markQualified(
    @Param('id') id: string,
    @Body()
    body: {
      serviceType: string;
      transactionId: string;
      transactionAmount: number;
    },
  ) {
    return this.referralsService.markQualified(
      id,
      body.serviceType,
      body.transactionId,
      body.transactionAmount,
    );
  }

  @Post(':id/reward')
  @RequirePermissions(PERMISSIONS.CRM.REFERRAL_MANAGE)
  markRewarded(
    @Param('id') id: string,
    @Body() body: { rewardAmount: number },
  ) {
    return this.referralsService.markRewarded(id, body.rewardAmount);
  }
}
