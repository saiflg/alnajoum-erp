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
import { PERMISSIONS } from './constants/permissions.constant';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RbacService } from './rbac.service';

import { RequireStepUp } from '../../common/security/step-up';
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLE.READ)
  listRoles() {
    return this.rbacService.listRoles();
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.PERMISSION.READ)
  listPermissions() {
    return this.rbacService.listPermissions();
  }

  @RequireStepUp()
  @Post('roles')
  @Roles('SUPER_ADMIN') // roles are global, so defining them is a platform operation
  @RequirePermissions(PERMISSIONS.ROLE.CREATE)
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @RequireStepUp()
  @Patch('roles/:roleId')
  @Roles('SUPER_ADMIN') // roles are global, so defining them is a platform operation
  @RequirePermissions(PERMISSIONS.ROLE.UPDATE)
  updateRole(@Param('roleId') roleId: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(roleId, dto);
  }

  @RequireStepUp()
  @Delete('roles/:roleId')
  @Roles('SUPER_ADMIN') // roles are global, so defining them is a platform operation
  @RequirePermissions(PERMISSIONS.ROLE.DELETE)
  deleteRole(@Param('roleId') roleId: string) {
    return this.rbacService.deleteRole(roleId);
  }

  @RequireStepUp()
  @Post('identities/:identityId/roles')
  @RequirePermissions(PERMISSIONS.ROLE.ASSIGN)
  assignRole(
    @CurrentUser() user: AuthContext,
    @Param('identityId') identityId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.rbacService.assignRoleToIdentity(identityId, dto, {
      sub: user.sub,
      roles: user.roles,
      companyId: user.companyId,
    });
  }

  @RequireStepUp()
  @Delete('identities/:identityId/roles/:roleId')
  @RequirePermissions(PERMISSIONS.ROLE.ASSIGN)
  removeRole(
    @CurrentUser() user: AuthContext,
    @Param('identityId') identityId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.rbacService.removeRoleFromIdentity(identityId, roleId, {
      sub: user.sub,
      roles: user.roles,
      companyId: user.companyId,
    });
  }
}
