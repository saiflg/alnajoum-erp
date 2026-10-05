import { ApnsPushNotificationProviderService } from './apns-push-notification-provider.service';
import { FcmPushNotificationProviderService } from './fcm-push-notification-provider.service';
import { MockPushNotificationProviderService } from './mock-push-notification-provider.service';
import { PushNotificationProviderRouter } from './push-notification-provider.router';

describe('PushNotificationProviderRouter', () => {
  const mockProvider = new MockPushNotificationProviderService();
  const fcmProvider = new FcmPushNotificationProviderService();
  const apnsProvider = new ApnsPushNotificationProviderService();
  const router = new PushNotificationProviderRouter(
    mockProvider,
    fcmProvider,
    apnsProvider,
  );

  const input = { token: 'tok-1', title: 'Hi', body: 'Body' };

  it('routes FCM-provider devices to the FCM stub, which reports not configured', async () => {
    const result = await router.sendPush({ ...input, provider: 'FCM' } as never);
    expect(result).toEqual({
      success: false,
      error: 'FCM is not configured for this deployment',
    });
  });

  it('routes APNS-provider devices to the APNs stub, which reports not configured', async () => {
    const result = await router.sendPush({ ...input, provider: 'APNS' } as never);
    expect(result).toEqual({
      success: false,
      error: 'APNs is not configured for this deployment',
    });
  });

  it('defaults an EXPO (or unknown) provider to the mock provider, which succeeds', async () => {
    const result = await router.sendPush({ ...input, provider: 'EXPO' } as never);
    expect(result).toEqual({ success: true });
  });

  it('defaults to the mock provider when no provider is given at all', async () => {
    const result = await router.sendPush(input);
    expect(result).toEqual({ success: true });
  });
});
