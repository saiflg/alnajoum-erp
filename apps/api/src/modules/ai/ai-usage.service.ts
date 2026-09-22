import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AiUsageStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';

const DEFAULT_DAILY_LIMIT = 200;

export interface LogAiUsageInput {
  identityId?: string;
  companyId?: string;
  requestType: string;
  provider: string;
  model?: string;
  question: string;
  matchedQuery?: string;
  status: AiUsageStatus;
  errorMessage?: string;
}

/**
 * Phase 13 spec #40/#41 — a usage audit trail (who asked, which
 * provider/model answered, matched or not) and a simple per-company daily
 * cap read from the same AI integration config admins already fill in at
 * /admin/integrations (spec #42's "Usage limits" field), so there's no
 * second settings surface to configure. `question` is kept as the
 * caller's own short free-text input, never a full prompt/system-message
 * dump — this is a usage log, not a transcript store.
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  /** Throws 429 when the caller's company has hit its configured daily
   * request cap. A caller with no companyId (shouldn't normally happen
   * for an authenticated request) is never limited here — there's no
   * tenant bucket to count against. */
  async enforceDailyLimit(companyId?: string): Promise<void> {
    if (!companyId) return;

    const activeProvider =
      await this.integrationsService.getActiveProvider('AI');
    const config = activeProvider
      ? await this.integrationsService.getCredentialConfig('AI', activeProvider)
      : null;
    const limit = Number(config?.dailyRequestLimit) || DEFAULT_DAILY_LIMIT;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const usedToday = await this.prisma.aiUsageLog.count({
      where: { companyId, createdAt: { gte: startOfToday } },
    });

    if (usedToday >= limit) {
      throw new HttpException(
        `This company has reached its daily AI request limit (${limit}). Try again tomorrow, or raise the limit at /admin/integrations.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  log(entry: LogAiUsageInput) {
    return this.prisma.aiUsageLog.create({ data: entry });
  }

  /** For the admin usage-review page (spec #40's "allow administrators to
   * review AI usage") — tenant-scoped the same way every other admin list
   * in this codebase is. */
  listRecent(tenantCompanyId?: string, take = 100) {
    return this.prisma.aiUsageLog.findMany({
      where:
        tenantCompanyId !== undefined
          ? { companyId: tenantCompanyId }
          : undefined,
      include: { identity: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
