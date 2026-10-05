/** DI token — inject with `@Inject(PUSH_NOTIFICATION_PROVIDER)`. */
export const PUSH_NOTIFICATION_PROVIDER = 'PUSH_NOTIFICATION_PROVIDER';

export interface SendPushInput {
  /** The device's push token — Expo push token, FCM registration token, or APNs device token, depending on which provider is active. */
  token: string;
  title: string;
  body: string;
  /** Free-form payload the client uses for deep-link routing (e.g. `{ type: 'booking.confirmed', bookingId: '...' }`). Never put sensitive values here — the OS notification tray is not a secure channel. */
  data?: Record<string, string>;
}

export interface SendPushResult {
  success: boolean;
  error?: string;
}

/**
 * Vendor-agnostic seam for mobile push, same "swap the DI binding, not the
 * call sites" shape as NotificationProviderPort/PaymentProviderPort. Real
 * providers (FCM, APNs) are never reachable without production credentials
 * this codebase explicitly must not hold during development — see
 * FcmPushNotificationProviderService/ApnsPushNotificationProviderService's
 * own doc comments — so MockPushNotificationProviderService is the only
 * one actually wired in by PushNotificationProviderRouter today.
 */
export interface PushNotificationProviderPort {
  sendPush(input: SendPushInput): Promise<SendPushResult>;
}
