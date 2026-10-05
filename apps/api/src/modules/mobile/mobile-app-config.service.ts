import { Injectable } from '@nestjs/common';
import { MobilePlatform } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpsertMobileAppConfigDto } from './dto/upsert-mobile-app-config.dto';

const DEFAULT_CONFIG = {
  minSupportedVersion: '0.0.0',
  recommendedVersion: '0.0.0',
  forceUpdate: false,
  maintenanceMode: false,
  maintenanceMessage: null as string | null,
};

/**
 * Phase 18 spec #32/#42 — backend-controlled mobile version/maintenance
 * gating, per platform. No row needs to exist until an admin actually
 * sets one (same "sensible default, not a seeded row" shape as
 * FinanceSettings) — a platform with no row is simply never forced to
 * update and never in maintenance mode.
 */
@Injectable()
export class MobileAppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(platform: MobilePlatform) {
    const config = await this.prisma.mobileAppConfig.findUnique({
      where: { platform },
    });
    return config ?? { platform, ...DEFAULT_CONFIG };
  }

  listAll() {
    return this.prisma.mobileAppConfig.findMany({
      orderBy: { platform: 'asc' },
    });
  }

  async upsert(
    platform: MobilePlatform,
    dto: UpsertMobileAppConfigDto,
    actorIdentityId: string,
  ) {
    const config = await this.prisma.mobileAppConfig.upsert({
      where: { platform },
      create: { platform, ...dto },
      update: dto,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'mobile.app_config_updated',
      entityType: 'MobileAppConfig',
      entityId: config.id,
      metadata: { platform, ...dto },
    });
    return config;
  }
}
