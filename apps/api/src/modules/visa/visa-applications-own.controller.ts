import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { SubmitVisaApplicationDto } from './dto/submit-visa-application.dto';
import { VisaService } from './visa.service';

@Controller('visa/applications/me')
export class VisaApplicationsOwnController {
  constructor(
    private readonly visaService: VisaService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async submit(
    @CurrentUser() user: AuthContext,
    @Body() dto: SubmitVisaApplicationDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.visaService.submit(customerId, dto);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.visaService.listForCustomer(customerId);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.visaService.getApplication(id, customerId);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.visaService.cancel(id, customerId);
  }
}
