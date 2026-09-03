import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovalStatus, VerificationStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { VerifyGuarantorDto } from './dto/verify-guarantor.dto';
import { GuarantorsService } from './guarantors.service';

@Controller('visa/guarantors')
export class GuarantorsAdminController {
  constructor(
    private readonly guarantorsService: GuarantorsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  list(
    @Query('verificationStatus') verificationStatus?: VerificationStatus,
    @Query('approvalStatus') approvalStatus?: ApprovalStatus,
  ) {
    return this.guarantorsService.list({ verificationStatus, approvalStatus });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VISA.VIEW)
  get(@Param('id') id: string) {
    return this.guarantorsService.get(id);
  }

  /** Staff attaching a guarantor on the customer's behalf (walk-in / phone). */
  @Post('for/:applicationId')
  @RequirePermissions(PERMISSIONS.VISA.CREATE)
  attachFor(
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateGuarantorDto,
  ) {
    return this.guarantorsService.attachToApplication(applicationId, dto);
  }

  @Post(':id/verify')
  @RequirePermissions(PERMISSIONS.VISA.GUARANTOR_VERIFY)
  async verify(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VerifyGuarantorDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can verify a guarantor');
    }
    return this.guarantorsService.verify(id, dto, staffId);
  }
}
