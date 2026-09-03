import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VisaApplicationStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { SubmitVisaApplicationDto } from './dto/submit-visa-application.dto';
import { UpdateVisaStatusDto } from './dto/update-visa-status.dto';
import { VisaService } from './visa.service';

@Controller('visa/applications')
export class VisaApplicationsAdminController {
  constructor(
    private readonly visaService: VisaService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: VisaApplicationStatus,
  ) {
    return this.visaService.listAll({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.READ)
  findOne(@Param('id') id: string) {
    return this.visaService.getApplication(id);
  }

  /** Staff submitting an application on a customer's behalf (walk-in / phone). */
  @Post('for/:customerId')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.CREATE)
  async submitFor(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: SubmitVisaApplicationDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.visaService.submit(customerId, dto, staffId ?? undefined);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateVisaStatusDto) {
    return this.visaService.updateStatus(id, dto.status, dto.staffNote);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.MANAGE)
  cancel(@Param('id') id: string) {
    return this.visaService.cancel(id);
  }
}
