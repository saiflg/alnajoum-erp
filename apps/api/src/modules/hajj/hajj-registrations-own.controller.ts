import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { RegisterHajjDto } from './dto/register-hajj.dto';
import { HajjRegistrationsService } from './hajj-registrations.service';

@Controller('hajj/registrations/me')
export class HajjRegistrationsOwnController {
  constructor(
    private readonly registrationsService: HajjRegistrationsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async register(
    @CurrentUser() user: AuthContext,
    @Body() dto: RegisterHajjDto,
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
