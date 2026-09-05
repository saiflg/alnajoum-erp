import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AddProviderMessageDto } from './dto/add-provider-message.dto';
import { VisaSubmissionsService } from './visa-submissions.service';

@Controller('visa/applications/:id/submission')
export class VisaSubmissionsController {
  constructor(
    private readonly service: VisaSubmissionsService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  list(@Param('id') id: string) {
    return this.service.listSubmissions(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VISA.SUBMIT)
  async submit(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.requireStaffId(user);
    return this.service.submit(id, staffId);
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.VISA.SUBMIT)
  async sync(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.requireStaffId(user);
    return this.service.syncStatus(id, staffId);
  }

  @Get('messages')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  listMessages(@Param('id') id: string) {
    return this.service.listProviderMessages(id);
  }

  @Post('messages')
  @RequirePermissions(PERMISSIONS.VISA.SUBMIT)
  addMessage(@Param('id') id: string, @Body() dto: AddProviderMessageDto) {
    return this.service.addManualProviderMessage(id, dto.message, dto.severity);
  }

  @Post('messages/:messageId/acknowledge')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  async acknowledge(
    @CurrentUser() user: AuthContext,
    @Param('messageId') messageId: string,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.service.acknowledgeProviderMessage(messageId, staffId);
  }
}
