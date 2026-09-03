import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { VisaServicesService } from './visa-services.service';

/**
 * Customer-facing visa catalog — active + available services only, and
 * deliberately reshaped to drop companyCost/margin/supplierCost/
 * supplierName/incentivePolicy before responding. Customers must never see
 * internal cost or incentive data (spec's "CUSTOMER PORTAL" section);
 * VisaServicesController (visa/services, staff-only) is the equivalent
 * full-detail endpoint.
 */
@Controller('visa/services/public')
export class VisaPublicController {
  constructor(private readonly visaServicesService: VisaServicesService) {}

  @Public()
  @Get()
  async list() {
    const services = await this.visaServicesService.listActive();
    return services.map((s) => ({
      id: s.id,
      serviceCode: s.serviceCode,
      country: s.country,
      visaType: s.visaType,
      visaCategory: s.visaCategory,
      description: s.description,
      processingTime: s.processingTime,
      validityPeriod: s.validityPeriod,
      entryType: s.entryType,
      requiredDocuments: s.requiredDocuments,
      currency: s.currency,
      price: s.sellingPrice + s.processingFee + s.otherFees,
      termsAndConditions: s.termsAndConditions,
    }));
  }
}
