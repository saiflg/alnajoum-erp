import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Spec #20 — centralized, database-backed settings for cross-cutting
 * configuration that doesn't already have a home (finance-specific
 * config lives in FinanceSettings, provider credentials in
 * IntegrationCredential — this is deliberately NOT a duplicate of
 * either). Spec #38 — every write is versioned into SystemSettingHistory
 * alongside the row itself, in the same transaction, so a setting's
 * change history is never separately reconstructable/losable.
 */
@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** companyId null = platform-wide default; most-specific-wins, same
   * pattern as everywhere else — a tenant's own row overrides the
   * platform default for the same category/key. */
  async get(
    category: string,
    key: string,
    companyId?: string,
  ): Promise<Prisma.JsonValue | undefined> {
    if (companyId) {
      const scoped = await this.prisma.systemSetting.findUnique({
        where: { companyId_category_key: { companyId, category, key } },
      });
      if (scoped) return scoped.value;
    }
    const platformDefault = await this.prisma.systemSetting.findFirst({
      where: { companyId: null, category, key },
    });
    return platformDefault?.value;
  }

  async listForCategory(category: string, tenantCompanyId?: string) {
    return this.prisma.systemSetting.findMany({
      where: {
        category,
        ...(tenantCompanyId !== undefined
          ? { OR: [{ companyId: tenantCompanyId }, { companyId: null }] }
          : {}),
      },
      orderBy: { key: 'asc' },
    });
  }

  async set(
    category: string,
    key: string,
    value: Prisma.InputJsonValue,
    updatedByIdentityId: string,
    companyId?: string,
    reason?: string,
  ) {
    const current = await this.prisma.systemSetting.findFirst({
      where: { companyId: companyId ?? null, category, key },
    });

    return this.prisma.$transaction(async (tx) => {
      const setting = current
        ? await tx.systemSetting.update({
            where: { id: current.id },
            data: { value, updatedByIdentityId },
          })
        : await tx.systemSetting.create({
            data: { companyId, category, key, value, updatedByIdentityId },
          });

      await tx.systemSettingHistory.create({
        data: {
          systemSettingId: setting.id,
          previousValue:
            current === null || current === undefined
              ? undefined
              : (current.value ?? Prisma.JsonNull),
          newValue: value,
          changedByIdentityId: updatedByIdentityId,
          reason,
        },
      });

      return setting;
    });
  }

  history(settingId: string) {
    return this.prisma.systemSettingHistory.findMany({
      where: { systemSettingId: settingId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
