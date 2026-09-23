import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { MetaWhatsAppProviderService } from './meta-whatsapp-provider.service';
import { MockWhatsAppProviderService } from './mock-whatsapp-provider.service';
import { WhatsAppProviderRouter } from './whatsapp-provider.router';

describe('WhatsAppProviderRouter', () => {
  let router: WhatsAppProviderRouter;
  let integrationsService: { getActiveProvider: jest.Mock };
  let mockProvider: { sendTextMessage: jest.Mock };
  let metaProvider: { sendTextMessage: jest.Mock };

  beforeEach(async () => {
    integrationsService = { getActiveProvider: jest.fn() };
    mockProvider = {
      sendTextMessage: jest
        .fn()
        .mockResolvedValue({ success: true, providerMessageId: 'mock-1' }),
    };
    metaProvider = {
      sendTextMessage: jest
        .fn()
        .mockResolvedValue({ success: true, providerMessageId: 'wamid.1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppProviderRouter,
        { provide: IntegrationsService, useValue: integrationsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock') },
        },
        { provide: MockWhatsAppProviderService, useValue: mockProvider },
        { provide: MetaWhatsAppProviderService, useValue: metaProvider },
      ],
    }).compile();

    router = module.get(WhatsAppProviderRouter);
  });

  it('routes to mock when it is the active provider', async () => {
    integrationsService.getActiveProvider.mockResolvedValue('mock');

    const result = await router.sendTextMessage({ to: '+234...', body: 'hi' });

    expect(result.providerMessageId).toBe('mock-1');
    expect(metaProvider.sendTextMessage).not.toHaveBeenCalled();
  });

  it('routes to meta when it is the active provider', async () => {
    integrationsService.getActiveProvider.mockResolvedValue('meta');

    const result = await router.sendTextMessage({ to: '+234...', body: 'hi' });

    expect(result.providerMessageId).toBe('wamid.1');
    expect(mockProvider.sendTextMessage).not.toHaveBeenCalled();
  });

  it('falls back to mock when no provider has been activated at all (spec #70)', async () => {
    integrationsService.getActiveProvider.mockResolvedValue(null);

    await router.sendTextMessage({ to: '+234...', body: 'hi' });

    expect(mockProvider.sendTextMessage).toHaveBeenCalled();
  });

  describe('activeProviderName', () => {
    it('reports "mock" by default', async () => {
      integrationsService.getActiveProvider.mockResolvedValue(null);
      await expect(router.activeProviderName()).resolves.toBe('mock');
    });

    it('reports "meta" once activated', async () => {
      integrationsService.getActiveProvider.mockResolvedValue('meta');
      await expect(router.activeProviderName()).resolves.toBe('meta');
    });
  });
});
