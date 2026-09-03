import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { SubmitVisaApplicationDto } from './dto/submit-visa-application.dto';
import { VisaService } from './visa.service';

/**
 * Strips internal cost/margin fields before a visa application (and its
 * linked VisaService, if any) is returned to the customer who owns it —
 * see the spec's "CUSTOMER PORTAL" section: customers must never see
 * company cost, selling-price-vs-cost margin, or the incentive policy
 * attached to a service. Everything else (status, guarantor status,
 * payment status, amounts they actually owe) passes through unchanged.
 */

type UnknownRecord = Record<string, unknown>;

function sanitizeForCustomer(application: UnknownRecord): UnknownRecord {
  const {
    companyCostSnapshot: _companyCostSnapshot,
    sellingPriceSnapshot: _sellingPriceSnapshot,
    ...rest
  } = application;
  const visaService = rest.visaService as UnknownRecord | null | undefined;
  if (visaService) {
    const {
      companyCost: _companyCost,
      supplierCost: _supplierCost,
      supplierName: _supplierName,
      incentivePolicyId: _incentivePolicyId,
      incentivePolicy: _incentivePolicy,
      ...safeService
    } = visaService;
    rest.visaService = safeService;
  }
  return rest;
}

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
    const application = await this.visaService.submit(customerId, dto);
    return sanitizeForCustomer(application);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const applications = await this.visaService.listForCustomer(customerId);
    return applications.map(sanitizeForCustomer);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const application = await this.visaService.getApplication(id, customerId);
    return sanitizeForCustomer(application);
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const application = await this.visaService.cancel(id, customerId);
    return sanitizeForCustomer(application);
  }
}
