import { NotificationType } from '@prisma/client';

/**
 * Spec #19 — "administrators can define mandatory notifications that
 * users cannot disable." Financial and account-security confirmations
 * only; every other type is opt-out via NotificationPreference.
 */
export const MANDATORY_NOTIFICATION_TYPES: ReadonlySet<NotificationType> =
  new Set([
    NotificationType.STAFF_TEMP_PASSWORD,
    NotificationType.PAYMENT_RECEIPT,
    NotificationType.MANUAL_PAYMENT_APPROVED,
    NotificationType.MANUAL_PAYMENT_REJECTED,
    NotificationType.INCENTIVE_PAID,
  ]);
