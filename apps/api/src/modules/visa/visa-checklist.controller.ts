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
import { CreateChecklistExceptionDto } from './dto/create-checklist-exception.dto';
import { VisaChecklistService } from './visa-checklist.service';

@Controller('visa/applications/:id/checklist')
export class VisaChecklistController {
  constructor(
    private readonly service: VisaChecklistService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  getChecklist(@Param('id') id: string) {
    return this.service.computeChecklist(id);
  }

  @Get('passport-validity')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  getPassportValidity(@Param('id') id: string) {
    return this.service.computePassportValidity(id);
  }

  @Post('exceptions')
  @RequirePermissions(PERMISSIONS.VISA.CHECKLIST_EXCEPTION)
  async addException(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateChecklistExceptionDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException(
        'Only staff can authorize a checklist exception',
      );
    }
    return this.service.addException(id, dto.documentType, dto.reason, staffId);
  }
}
