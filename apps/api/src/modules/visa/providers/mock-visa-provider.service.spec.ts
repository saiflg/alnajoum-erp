import { Test, TestingModule } from '@nestjs/testing';
import { MockVisaProviderService } from './mock-visa-provider.service';

describe('MockVisaProviderService', () => {
  let service: MockVisaProviderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockVisaProviderService],
    }).compile();
    service = module.get(MockVisaProviderService);
  });

  it('submitApplication returns a MOCKVISA- reference and RECEIVED status', async () => {
    const result = await service.submitApplication({
      applicationReference: 'VISA-2026-000001',
      destinationCountry: 'UAE',
      visaType: 'TOURIST',
      applicantFirstName: 'Amina',
      applicantLastName: 'Bello',
      applicantPassportNumber: 'A1234567',
    });

    expect(result.externalReference).toMatch(/^MOCKVISA-[A-F0-9]{8}$/);
    expect(result.providerStatus).toBe('RECEIVED');
  });

  it('advances the deterministic state machine one step per call', async () => {
    const step1 = await service.checkStatus('MOCKVISA-AAAA1111', null);
    expect(step1.providerStatus).toBe('PROCESSING');
    expect(step1.requiresAction).toBe(false);

    const step2 = await service.checkStatus(
      'MOCKVISA-AAAA1111',
      step1.providerStatus,
    );
    expect(step2.providerStatus).toBe('ADDITIONAL_INFO_REQUIRED');
    expect(step2.requiresAction).toBe(true);

    const step3 = await service.checkStatus(
      'MOCKVISA-AAAA1111',
      step2.providerStatus,
    );
    expect(step3.providerStatus).toBe('PROCESSING_2');

    const step4 = await service.checkStatus(
      'MOCKVISA-AAAA1111',
      step3.providerStatus,
    );
    expect(step4.providerStatus).toBe('APPROVED');
  });

  it('stays at APPROVED once reached — never regresses or loops', async () => {
    const result = await service.checkStatus('MOCKVISA-AAAA1111', 'APPROVED');
    expect(result.providerStatus).toBe('APPROVED');
  });

  it('is deterministic — the same previousStatus always produces the same next status', async () => {
    const a = await service.checkStatus('ref', 'PROCESSING');
    const b = await service.checkStatus('ref', 'PROCESSING');
    expect(a.providerStatus).toBe(b.providerStatus);
  });
});
