import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { InvestmentType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CompanyInvestmentsService } from './company-investments.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';

/** Spec #15/#16 — Super Admin / Company Admin only (see default-roles.constant.ts). */
@Controller('finance/investments')
@RequirePermissions(PERMISSIONS.FINANCE.INVESTMENT_MANAGE)
export class CompanyInvestmentsController {
  constructor(private readonly service: CompanyInvestmentsService) {}

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateInvestmentDto) {
    return this.service.create(dto, user.sub);
  }

  @Get()
  listAll(@Query('type') type?: InvestmentType) {
    return this.service.listAll({ type });
  }

  @Get('position')
  position() {
    return this.service.position();
  }
}
