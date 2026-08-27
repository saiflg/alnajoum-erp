import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { RegisterUmrahDto } from './dto/register-umrah.dto';
import { UmrahRegistrationsService } from './umrah-registrations.service';

@Controller('umrah/registrations/me')
export class UmrahRegistrationsOwnController {
  constructor(
    private readonly registrationsService: UmrahRegistrationsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async register(
    @CurrentUser() user: AuthContext,
    @Body() dto: RegisterUmrahDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.registrationsService.register(
      customerId,
      dto.packageId,
      dto.pilgrims,
    );
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.registrationsService.listForCustomer(customerId);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.registrationsService.getRegistration(id, customerId);
  }
}
