import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from '../../integrations/integrations.service';
import { ManualVisaProviderService } from './manual-visa-provider.service';
import { MockVisaProviderService } from './mock-visa-provider.service';
import { VisaProviderRouter } from './visa-provider.router';

describe('VisaProviderRouter', () => {
  let router: VisaProviderRouter;
  let integrationsService: { getActiveProvider: jest.Mock };
  let configService: { get: jest.Mock };
  let manualProvider: { submitApplication: jest.Mock; checkStatus: jest.Mock };
  let mockProvider: { submitApplication: jest.Mock; checkStatus: jest.Mock };

  beforeEach(async () => {
    integrationsService = { getActiveProvider: jest.fn() };
    configService = { get: jest.fn() };
    manualProvider = { submitApplication: jest.fn(), checkStatus: jest.fn() };
    mockProvider = { submitApplication: jest.fn(), checkStatus: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisaProviderRouter,
        { provide: IntegrationsService, useValue: integrationsService },
        { provide: ConfigService, useValue: configService },
        { provide: ManualVisaProviderService, useValue: manualProvider },
        { provide: MockVisaProviderService, useValue: mockProvider },
      ],
    }).compile();

    router = module.get(VisaProviderRouter);
  });

  it('routes to the manual provider when none is active and no env var is set', async () => {
    integrationsService.getActiveProvider.mockResolvedValue(null);
    configService.get.mockReturnValue('manual');

    await router.submitApplication({
      applicationReference: 'VISA-2026-000001',
      destinationCountry: 'UAE',
      visaType: 'TOURIST',
      applicantFirstName: 'A',
      applicantLastName: 'B',
      applicantPassportNumber: null,
    });

    expect(manualProvider.submitApplication).toHaveBeenCalled();
    expect(mockProvider.submitApplication).not.toHaveBeenCalled();
  });

  it('routes to the mock provider once activated via /admin/integrations', async () => {
    integrationsService.getActiveProvider.mockResolvedValue('mock');

    await router.checkStatus('MOCKVISA-1', 'RECEIVED');

    expect(mockProvider.checkStatus).toHaveBeenCalledWith(
      'MOCKVISA-1',
      'RECEIVED',
    );
    expect(manualProvider.checkStatus).not.toHaveBeenCalled();
  });

  it('getActiveProviderName reflects the active setting, falling back to the env var', async () => {
    integrationsService.getActiveProvider.mockResolvedValue(null);
    configService.get.mockReturnValue('mock');

    await expect(router.getActiveProviderName()).resolves.toBe('mock');
  });

  it('an unrecognized active provider name falls back to manual', async () => {
    integrationsService.getActiveProvider.mockResolvedValue(
      'some-future-provider',
    );

    await expect(router.getActiveProviderName()).resolves.toBe('manual');
  });

  describe('resolveByName', () => {
    it('returns the mock provider regardless of what is currently active', () => {
      integrationsService.getActiveProvider.mockResolvedValue('manual');

      expect(router.resolveByName('mock')).toBe(mockProvider);
    });

    it('returns the manual provider regardless of what is currently active', () => {
      integrationsService.getActiveProvider.mockResolvedValue('mock');

      expect(router.resolveByName('manual')).toBe(manualProvider);
    });
  });
});
