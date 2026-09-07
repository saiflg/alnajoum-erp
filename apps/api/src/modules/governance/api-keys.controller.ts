import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api-keys')
@RequirePermissions(PERMISSIONS.API_KEY.MANAGE)
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.service.listForOwner(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateApiKeyDto) {
    return this.service.create(user.sub, dto);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.service.revoke(id, user.sub);
  }
}
