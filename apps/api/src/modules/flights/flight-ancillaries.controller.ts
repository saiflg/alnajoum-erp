import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { PurchaseFlightAncillaryDto } from './dto/purchase-flight-ancillary.dto';
import { FlightAncillariesService } from './flight-ancillaries.service';

@Controller('flights/bookings/:id/ancillaries')
@RequirePermissions(PERMISSIONS.FLIGHT.ANCILLARY_MANAGE)
export class FlightAncillariesController {
  constructor(
    private readonly service: FlightAncillariesService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  list(@Param('id') id: string) {
    return this.service.listForBooking(id);
  }

  @Post()
  async purchase(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: PurchaseFlightAncillaryDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.service.purchase(id, dto, staffId ?? undefined);
  }
}
