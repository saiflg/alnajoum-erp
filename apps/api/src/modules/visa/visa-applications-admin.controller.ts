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
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AddVisaNoteDto } from './dto/add-visa-note.dto';
import { AssignVisaApplicationDto } from './dto/assign-visa-application.dto';
import { SubmitVisaApplicationForDto } from './dto/record-offline-visa.dto';
import { RequestVisaRefundDto } from './dto/request-visa-refund.dto';
import { UpdateVisaStatusDto } from './dto/update-visa-status.dto';
import { VisaRefundsService } from './visa-refunds.service';
import { VisaService } from './visa.service';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

import { TenantScoped } from '../../common/tenancy/tenant-scoped.decorator';
@RequireFeature('ENABLE_VISA')
@Controller('visa/applications')
export class VisaApplicationsAdminController {
  constructor(
    private readonly visaService: VisaService,
    private readonly usersService: UsersService,
    private readonly refundsService: VisaRefundsService,
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
    @CurrentUser() user: AuthContext,
    @Query('customerId') customerId?: string,
    @Query('status') status?: VisaApplicationStatus,
    @Query('assignedStaffId') assignedStaffId?: string,
  ) {
    return this.visaService.listAll(
      { customerId, status, assignedStaffId },
      resolveTenantFilter(user),
    );
  }

  @TenantScoped('visaApplication')
  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.READ)
  findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.visaService.getApplication(
      id,
      undefined,
      resolveTenantFilter(user),
    );
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

  @TenantScoped('visaApplication')
  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateVisaStatusDto) {
    return this.visaService.updateStatus(id, dto.status, dto.staffNote);
  }

  @TenantScoped('visaApplication')
  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.VISA_APPLICATION.MANAGE)
  cancel(@Param('id') id: string) {
    return this.visaService.cancel(id);
  }

  @TenantScoped('visaApplication')
  @Post(':id/verify-payment')
  @RequirePermissions(PERMISSIONS.VISA.PAYMENT_VERIFY)
  async verifyPayment(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.visaService.markPaymentVerified(id, staffId);
  }

  @TenantScoped('visaApplication')
  @TenantScoped({ kind: 'staff', param: 'staffId', source: 'body' })
  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.VISA.ASSIGN)
  async assign(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AssignVisaApplicationDto,
  ) {
    return this.visaService.assign(id, dto.staffId, user.sub);
  }

  @TenantScoped('visaApplication')
  @Get(':id/notes')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  listNotes(@Param('id') id: string) {
    return this.visaService.listNotes(id);
  }

  @TenantScoped('visaApplication')
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

  @TenantScoped('visaApplication')
  @Get(':id/refund-preview')
  @RequirePermissions(PERMISSIONS.VISA.REFUND)
  previewRefund(@Param('id') id: string) {
    return this.refundsService.previewRefund(id);
  }

  @TenantScoped('visaApplication')
  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.VISA.REFUND)
  async requestRefund(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RequestVisaRefundDto,
  ) {
    const staffId = await this.requireStaffId(user);
    return this.refundsService.requestRefund(id, {
      requestedByStaffId: staffId,
      reason: dto.reason,
    });
  }

  @TenantScoped('visaApplication')
  @Get(':id/refunds')
  @RequirePermissions(PERMISSIONS.VISA.REFUND)
  listRefunds(@Param('id') id: string) {
    return this.refundsService.listAll({ applicationId: id });
  }
}
