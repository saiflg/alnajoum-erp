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
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CountryVisaRulesService } from './country-visa-rules.service';
import { CreateCountryVisaRuleDto } from './dto/create-country-visa-rule.dto';
import { UpdateCountryVisaRuleDto } from './dto/update-country-visa-rule.dto';

@Controller('visa/country-rules')
export class CountryVisaRulesController {
  constructor(private readonly service: CountryVisaRulesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.VISA.RULES_MANAGE)
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateCountryVisaRuleDto,
  ) {
    return this.service.create(dto, user.sub);
  }

  /**
   * Public (bare @RequirePermissions()) — spec #4: "the system should
   * display relevant requirements automatically when staff select the
   * destination and visa type", and the customer-facing application form
   * needs the same list before a customer has any RBAC permission at all.
   */
  @Get()
  @Public()
  listAll(@Query('country') country?: string) {
    return this.service.listAll({ country, isActive: true });
  }

  @Get('applicable')
  @Public()
  getApplicable(
    @Query('country') country: string,
    @Query('visaType') visaType?: string,
  ) {
    return this.service.getApplicableRule(country, visaType ?? null);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VISA.RULES_MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCountryVisaRuleDto,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Patch(':id/deactivate')
  @RequirePermissions(PERMISSIONS.VISA.RULES_MANAGE)
  deactivate(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.deactivate(id, user.sub);
  }
}
