import {
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
import { FlightVoidsService } from './flight-voids.service';

@Controller('flights/bookings/:id/void')
@RequirePermissions(PERMISSIONS.FLIGHT.VOID)
export class FlightVoidsController {
  constructor(
    private readonly service: FlightVoidsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('eligibility')
  eligibility(@Param('id') id: string) {
    return this.service.getEligibility(id);
  }

  // Mirrors FlightRefundsService's `GET :id/refunds` — a booking may have
  // more than one void attempt (e.g. a FAILED try followed by a retry).
  @Get()
  list(@Param('id') id: string) {
    return this.service.listAll({ bookingId: id });
  }

  @Post()
  async request(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can void a ticket');
    }
    return this.service.requestVoid(id, staffId);
  }
}
