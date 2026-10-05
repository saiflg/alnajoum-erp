import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdatePushTokenDto } from './dto/update-push-token.dto';

/**
 * Phase 18 spec #6 — device registration, separate from RefreshToken
 * "sessions" (SessionsService): a session is a login, a device is an
 * installed app instance that can outlive many logins/logouts and is
 * what push notifications target. `deviceId` is self-reported by the
 * client (a stable installation id) — registering again with the same
 * one on the same identity updates the existing row (reinstall/app
 * restart), never creates a duplicate.
 */
@Injectable()
export class MobileDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async register(identityId: string, dto: RegisterDeviceDto) {
    const device = await this.prisma.mobileDevice.upsert({
      where: { identityId_deviceId: { identityId, deviceId: dto.deviceId } },
      create: {
        identityId,
        deviceId: dto.deviceId,
        platform: dto.platform,
        appVersion: dto.appVersion,
        osVersion: dto.osVersion,
        pushToken: dto.pushToken,
        pushProvider: dto.pushToken ? dto.pushProvider ?? 'EXPO' : null,
      },
      update: {
        platform: dto.platform,
        appVersion: dto.appVersion,
        osVersion: dto.osVersion,
        pushToken: dto.pushToken,
        pushProvider: dto.pushToken ? dto.pushProvider ?? 'EXPO' : null,
        lastActiveAt: new Date(),
        revokedAt: null, // re-registering un-revokes — the app is installed and running again
      },
    });
    await this.auditService.record({
      identityId,
      action: 'mobile.device_registered',
      entityType: 'MobileDevice',
      entityId: device.id,
      metadata: { platform: dto.platform, appVersion: dto.appVersion },
    });
    return device;
  }

  listForIdentity(identityId: string) {
    return this.prisma.mobileDevice.findMany({
      where: { identityId },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  private async getOwnedDevice(identityId: string, id: string) {
    const device = await this.prisma.mobileDevice.findUnique({
      where: { id },
    });
    if (!device || device.identityId !== identityId) {
      // NotFound, not Forbidden — same "don't confirm another identity's
      // row exists" reasoning as SessionsService.getOwnedSession.
      throw new NotFoundException('Device not found');
    }
    return device;
  }

  /** Updates only the push token/provider — called on every app foreground
   * so a rotated Expo/FCM/APNs token never goes stale without the
   * customer re-registering the whole device. */
  async updatePushToken(identityId: string, id: string, dto: UpdatePushTokenDto) {
    await this.getOwnedDevice(identityId, id);
    return this.prisma.mobileDevice.update({
      where: { id },
      data: {
        pushToken: dto.pushToken,
        pushProvider: dto.pushToken ? dto.pushProvider ?? 'EXPO' : null,
        lastActiveAt: new Date(),
      },
    });
  }

  /** Spec #6/#30 — customer "sign out this device". Clears the push token
   * too, so a revoked device can never receive push even if some caller
   * fetched a stale device row before the revoke. */
  async revoke(identityId: string, id: string) {
    const device = await this.getOwnedDevice(identityId, id);
    if (device.revokedAt) return device;
    const updated = await this.prisma.mobileDevice.update({
      where: { id },
      data: { revokedAt: new Date(), pushToken: null, pushProvider: null },
    });
    await this.auditService.record({
      identityId,
      action: 'security.mobile_device_revoked',
      entityType: 'MobileDevice',
      entityId: id,
    });
    return updated;
  }
}
