import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';
import { TaxRulesService } from './tax-rules.service';

@Controller('tax-rules')
export class TaxRulesController {
  constructor(private readonly service: TaxRulesService) {}

  /** Bare @RequirePermissions() — reference data, same read-is-open
   * pattern as CurrencyController/country visa rules. */
  @Get()
  @RequirePermissions()
  list(
    @Query('applicableService') applicableService?: string,
    @Query('country') country?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.listAll({
      applicableService,
      country,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions()
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TAX.MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateTaxRuleDto) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TAX.MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaxRuleDto,
  ) {
    return this.service.update(id, dto, user.sub);
  }
}
