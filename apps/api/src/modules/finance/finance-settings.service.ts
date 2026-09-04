import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const SETTINGS_ID = 'default';

/** Spec #14's configurable payout-approval thresholds — a singleton row, upserted lazily so no migration seed step is required. */
@Injectable()
export class FinanceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get() {
    return this.prisma.financeSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
    });
  }

  async update(
    data: { payoutApprovalTier1Max?: number; payoutApprovalTier2Max?: number },
    actorIdentityId?: string,
  ) {
    const updated = await this.prisma.financeSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'finance.settings_updated',
      entityType: 'FinanceSettings',
      entityId: SETTINGS_ID,
      metadata: data,
    });
    return updated;
  }
}
