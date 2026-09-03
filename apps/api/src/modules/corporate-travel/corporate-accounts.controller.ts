import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CorporateTravelService } from './corporate-travel.service';
import { CreateCorporateAccountDto } from './dto/create-corporate-account.dto';
import { CreateCorporateBookingDto } from './dto/create-corporate-booking.dto';
import { CreateCorporateTravelerDto } from './dto/create-corporate-traveler.dto';
import { UpdateCorporateAccountDto } from './dto/update-corporate-account.dto';

@Controller('corporate-travel/accounts')
export class CorporateAccountsController {
  constructor(
    private readonly corporateTravelService: CorporateTravelService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.MANAGE)
  create(@Body() dto: CreateCorporateAccountDto) {
    return this.corporateTravelService.createAccount(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  list(@Query('managedBranchId') managedBranchId?: string) {
    return this.corporateTravelService.listAccounts({ managedBranchId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  findOne(@Param('id') id: string) {
    return this.corporateTravelService.getAccount(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateCorporateAccountDto) {
    return this.corporateTravelService.updateAccount(id, dto);
  }

  @Post(':id/travelers')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.MANAGE)
  addTraveler(
    @Param('id') id: string,
    @Body() dto: CreateCorporateTravelerDto,
  ) {
    return this.corporateTravelService.addTraveler(id, dto);
  }

  @Get(':id/travelers')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.READ)
  listTravelers(@Param('id') id: string) {
    return this.corporateTravelService.listTravelers(id);
  }

  @Post(':id/bookings')
  @RequirePermissions(PERMISSIONS.CORPORATE_TRAVEL.MANAGE)
  async createBooking(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateCorporateBookingDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      // Defensive only — CORPORATE_TRAVEL.MANAGE is never granted to the
      // customer-facing role, so a non-staff identity can't reach here in
      // practice (see default-roles.constant.ts).
      throw new ForbiddenException('Only staff can create corporate bookings');
    }
    return this.corporateTravelService.createBooking(id, dto, staffId);
  }
}
