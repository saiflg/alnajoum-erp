import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
} from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CheckInService } from './checkin.service';
import { CheckInByCodeDto, CheckInDto } from './dto/checkin.dto';

@Controller('hajj-ops/checkin')
export class CheckInController {
  constructor(
    private readonly service: CheckInService,
    private readonly usersService: UsersService,
  ) {}

  /** Spec #33 — (re)generates this pilgrim's QR payload (an opaque internal code, never passport/financial data). */
  @Get('qr/:type/:id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECK_IN)
  getQrCode(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
  ) {
    return this.service.getOrCreateQrCode(type, id);
  }

  /** Spec #34 — scan-based check-in by the pilgrim's QR code. */
  @Post('scan')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECK_IN)
  async checkInByCode(
    @CurrentUser() user: AuthContext,
    @Body() dto: CheckInByCodeDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.service.checkInByCode(
      dto.pilgrimCode,
      dto.event,
      staffId ?? undefined,
      dto.location,
    );
  }

  /** Manual check-in fallback (no QR scanner available). */
  @Post(':type/:id')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECK_IN)
  async checkIn(
    @CurrentUser() user: AuthContext,
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.service.recordCheckIn(
      type,
      id,
      dto.event,
      staffId ?? undefined,
      dto.location,
    );
  }

  @Get(':type/:id/history')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.CHECK_IN)
  history(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('id') id: string,
  ) {
    return this.service.history(type, id);
  }
}
