import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateIncentivePolicyDto } from './dto/create-incentive-policy.dto';
import { UpdateIncentivePolicyDto } from './dto/update-incentive-policy.dto';
import { IncentivePoliciesService } from './incentive-policies.service';

@Controller('visa/incentive-policies')
export class IncentivePoliciesController {
  constructor(
    private readonly incentivePoliciesService: IncentivePoliciesService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.VISA.EDIT)
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateIncentivePolicyDto,
  ) {
    return this.incentivePoliciesService.create(dto, user.sub);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  list() {
    return this.incentivePoliciesService.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  get(@Param('id') id: string) {
    return this.incentivePoliciesService.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VISA.EDIT)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateIncentivePolicyDto,
  ) {
    return this.incentivePoliciesService.update(id, dto, user.sub);
  }
}
