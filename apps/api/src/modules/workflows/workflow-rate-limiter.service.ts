import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DEFAULT_LIMITS, RateLimit } from './engine/rate-limit';

export interface ConsumeResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Database-backed automation rate limits. One atomic statement per check, so several API
 * instances share one counter and a burst cannot slip past a read-then-write race. A
 * throttled step is DEFERRED by the executor (retried after `retryAfterMs`), never dropped.
 */
@Injectable()
export class WorkflowRateLimiterService {
  constructor(private readonly prisma: PrismaService) {}

  async consume(
    companyId: string,
    limitKey: string,
    limit: RateLimit = DEFAULT_LIMITS[limitKey],
  ): Promise<ConsumeResult> {
    if (!limit) return { allowed: true, retryAfterMs: 0 };
    const key = `${companyId}:${limitKey}`;
    const rows = await this.prisma.$queryRaw<
      { windowStart: Date; count: number }[]
    >`
      INSERT INTO "workflow_rate_counters" ("key", "windowStart", "count")
      VALUES (${key}, now(), 1)
      ON CONFLICT ("key") DO UPDATE SET
        "windowStart" = CASE WHEN "workflow_rate_counters"."windowStart" + (${limit.windowMs}::int * interval '1 millisecond') <= now()
                             THEN now() ELSE "workflow_rate_counters"."windowStart" END,
        "count" = CASE WHEN "workflow_rate_counters"."windowStart" + (${limit.windowMs}::int * interval '1 millisecond') <= now()
                       THEN 1 ELSE "workflow_rate_counters"."count" + 1 END
      RETURNING "windowStart", "count"`;
    const row = rows[0];
    if (row.count <= limit.max) return { allowed: true, retryAfterMs: 0 };
    return {
      allowed: false,
      retryAfterMs: Math.max(
        1000,
        new Date(row.windowStart).getTime() + limit.windowMs - Date.now(),
      ),
    };
  }
}
