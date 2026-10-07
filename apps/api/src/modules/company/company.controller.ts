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
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * Creating or removing a tenant is a platform operation (SUPER_ADMIN only, enforced by @Roles on top
 * of the permission). Everything else is bound to the caller's own company: another company's id is
 * a 404, and the list contains only the caller's company.
 */
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERMISSIONS.COMPANY.CREATE)
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COMPANY.READ)
  findAll(@CurrentUser() user: AuthContext) {
    return this.companyService.findAll(resolveTenantFilter(user));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COMPANY.READ)
  findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.companyService.findOne(id, resolveTenantFilter(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COMPANY.UPDATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companyService.update(id, dto, resolveTenantFilter(user));
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERMISSIONS.COMPANY.DELETE)
  remove(@Param('id') id: string) {
    return this.companyService.remove(id);
  }
}
