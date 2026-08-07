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

    expect(result).toEqual({ success: true });
  });
});
