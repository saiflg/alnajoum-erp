import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { FinanceSettingsService } from './finance-settings.service';

class UpdateFinanceSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  payoutApprovalTier1Max?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  payoutApprovalTier2Max?: number;
}

@Controller('finance/settings')
@RequirePermissions(PERMISSIONS.FINANCE.SETTINGS_MANAGE)
export class FinanceSettingsController {
  constructor(private readonly service: FinanceSettingsService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Patch()
  update(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateFinanceSettingsDto,
  ) {
    return this.service.update(dto, user.sub);
  }
}
