import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CustomersService } from './customers.service';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  findAll() {
    return this.customersService.findAll();
  }

  @Get('me')
  getOwnProfile(@CurrentUser() user: AuthContext) {
    return this.customersService.findByIdentityId(user.sub);
  }

  @Patch('me')
  updateOwnProfile(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return this.customersService.updateByIdentityId(user.sub, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER.READ)
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER.UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateCustomerProfileDto) {
    return this.customersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER.DELETE)
  remove(@Param('id') id: string) {
    return this.customersService.deactivate(id);
  }
}
