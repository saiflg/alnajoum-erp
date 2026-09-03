import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { VisaApplicationStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AddVisaNoteDto } from './dto/add-visa-note.dto';
import { AssignVisaApplicationDto } from './dto/assign-visa-application.dto';
import { SubmitVisaApplicationForDto } from './dto/record-offline-visa.dto';
import { UpdateVisaStatusDto } from './dto/update-visa-status.dto';
import { VisaService } from './visa.service';

@Controller('visa/applications')
export class VisaApplicationsAdminController {
  constructor(
    private readonly visaService: VisaService,
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
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.READ)
  list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: VisaApplicationStatus,
    @Query('assignedStaffId') assignedStaffId?: string,
  ) {
    return this.visaService.listAll({ customerId, status, assignedStaffId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.READ)
  findOne(@Param('id') id: string) {
    return this.visaService.getApplication(id);
  }

  /**
   * Staff submitting an application on a customer's behalf (walk-in /
   * phone), or recording one processed entirely offline — see
   * SubmitVisaApplicationForDto's isOfflineEntry/guarantorExempt fields,
   * which only staff can set.
   */
  @Post('for/:customerId')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.CREATE)
  async submitFor(
    @CurrentUser() user: AuthContext,
    @Param('customerId') customerId: string,
    @Body() dto: SubmitVisaApplicationForDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.visaService.submit(customerId, dto, staffId ?? undefined, {
      isOfflineEntry: dto.isOfflineEntry,
      offlineReason: dto.offlineReason,
      guarantorExempt: dto.guarantorExempt,
      guarantorExemptReason: dto.guarantorExemptReason,
    });
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

  @Post(':id/verify-payment')
  @RequirePermissions(PERMISSIONS.VISA.PAYMENT_VERIFY)
  async verifyPayment(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.visaService.markPaymentVerified(id, staffId);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.VISA.ASSIGN)
  async assign(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AssignVisaApplicationDto,
  ) {
    return this.visaService.assign(id, dto.staffId, user.sub);
  }

  @Get(':id/notes')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  listNotes(@Param('id') id: string) {
    return this.visaService.listNotes(id);
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.VISA.REVIEW)
  async addNote(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddVisaNoteDto,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.visaService.addNote(id, staffId, dto.note);
  }
}
