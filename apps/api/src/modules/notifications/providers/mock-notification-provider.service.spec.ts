import { Test, TestingModule } from '@nestjs/testing';
import { MockNotificationProviderService } from './mock-notification-provider.service';

describe('MockNotificationProviderService', () => {
  let service: MockNotificationProviderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockNotificationProviderService],
    }).compile();

    service = module.get(MockNotificationProviderService);
  });

  it('always reports success without actually sending anything', async () => {
    const result = await service.sendEmail({
      to: 'customer@example.com',
      subject: 'Test',
      textBody: 'Hello',
    });

    // Phase 26: the mock says plainly that it is a simulation and hands back an id reports can show.
    expect(result).toEqual({
      success: true,
      simulated: true,
      providerMessageId: expect.stringMatching(/^mock-email-/) as string,
    });
  });

  it('always reports success for SMS without actually sending anything', async () => {
    const result = await service.sendSms({
      to: '+2348000000101',
      body: 'Hello',
    });

    expect(result).toEqual({ success: true });
  });

  it('always reports success for WhatsApp without actually sending anything', async () => {
    const result = await service.sendWhatsApp({
      to: '+2348000000101',
      body: 'Hello',
    });

    expect(result).toEqual({ success: true });
  });
});
