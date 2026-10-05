import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdatePushTokenDto } from './dto/update-push-token.dto';
import { MobileDevicesService } from './mobile-devices.service';

/** Self-service device management — any authenticated identity manages
 * only their own, no RBAC permission required, same shape as /auth/sessions. */
@Controller('mobile/devices')
export class MobileDevicesController {
  constructor(private readonly devicesService: MobileDevicesService) {}

  @Get('me')
  list(@CurrentUser() user: AuthContext) {
    return this.devicesService.listForIdentity(user.sub);
  }

  @Post('me')
  register(@CurrentUser() user: AuthContext, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.register(user.sub, dto);
  }

  @Patch('me/:id/push-token')
  updatePushToken(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdatePushTokenDto,
  ) {
    return this.devicesService.updatePushToken(user.sub, id, dto);
  }

  @Delete('me/:id')
  revoke(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.devicesService.revoke(user.sub, id);
  }
}
