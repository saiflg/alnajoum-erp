import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { BranchService } from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCH.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateBranchDto) {
    return this.branchService.create(dto, resolveTenantFilter(user));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.BRANCH.READ)
  findAll(
    @CurrentUser() user: AuthContext,
    @Query('companyId') companyId?: string,
  ) {
    return this.branchService.findAll(companyId, resolveTenantFilter(user));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BRANCH.READ)
  findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.branchService.findOne(id, resolveTenantFilter(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCH.UPDATE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.update(id, dto, resolveTenantFilter(user));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BRANCH.DELETE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.branchService.remove(id, resolveTenantFilter(user));
  }
}
