import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { ApprovalThresholdRulesService } from './approval-threshold-rules.service';
import { CreateApprovalThresholdRuleDto } from './dto/create-approval-threshold-rule.dto';
import { UpdateApprovalThresholdRuleDto } from './dto/update-approval-threshold-rule.dto';

@Controller('approval-threshold-rules')
@RequirePermissions(PERMISSIONS.APPROVAL.CONFIGURE)
export class ApprovalThresholdRulesController {
  constructor(private readonly service: ApprovalThresholdRulesService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.service.list(resolveTenantFilter(user));
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateApprovalThresholdRuleDto,
  ) {
    const tenantCompanyId = resolveTenantFilter(user);
    return this.service.create(
      dto,
      tenantCompanyId === undefined ? undefined : tenantCompanyId,
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApprovalThresholdRuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
