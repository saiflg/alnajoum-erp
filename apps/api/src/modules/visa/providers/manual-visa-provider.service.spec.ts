import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ManualVisaProviderService } from './manual-visa-provider.service';

describe('ManualVisaProviderService', () => {
  let service: ManualVisaProviderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ManualVisaProviderService],
    }).compile();
    service = module.get(ManualVisaProviderService);
  });

  it('submitApplication records MANUAL_PROCESSING with no external reference', async () => {
    const result = await service.submitApplication({
      applicationReference: 'VISA-2026-000001',
      destinationCountry: 'UAE',
      visaType: 'TOURIST',
      applicantFirstName: 'Amina',
      applicantLastName: 'Bello',
      applicantPassportNumber: 'A1234567',
    });

    expect(result.externalReference).toBeNull();
    expect(result.providerStatus).toBe('MANUAL_PROCESSING');
    expect(result.message).toBeTruthy();
  });

  it('checkStatus always throws — manual processing has no provider API to poll', () => {
    expect(() => service.checkStatus()).toThrow(BadRequestException);
  });
});
