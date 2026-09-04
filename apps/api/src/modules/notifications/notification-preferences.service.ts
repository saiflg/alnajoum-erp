import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MANDATORY_NOTIFICATION_TYPES } from './constants/mandatory-notification-types.constant';

/** Spec #18/#19 — per-identity channel opt-out, overridden by MANDATORY_NOTIFICATION_TYPES. */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(identityId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { identityId },
    });
    if (existing) return existing;
    // Defaults mirror the model's own column defaults — no row needs to
    // exist until someone actually changes a preference.
    return {
      identityId,
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: true,
      inAppEnabled: true,
    };
  }

  update(
    identityId: string,
    data: Partial<{
      emailEnabled: boolean;
      smsEnabled: boolean;
      whatsappEnabled: boolean;
      inAppEnabled: boolean;
    }>,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { identityId },
      create: { identityId, ...data },
      update: data,
    });
  }

  /** True = allowed to send. A mandatory type always returns true. */
  async isAllowed(
    identityId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (MANDATORY_NOTIFICATION_TYPES.has(type)) return true;
    const prefs = await this.get(identityId);
    switch (channel) {
      case NotificationChannel.EMAIL:
        return prefs.emailEnabled;
      case NotificationChannel.SMS:
        return prefs.smsEnabled;
      case NotificationChannel.WHATSAPP:
        return prefs.whatsappEnabled;
      case NotificationChannel.IN_APP:
        return prefs.inAppEnabled;
      default:
        return true;
    }
  }
}
