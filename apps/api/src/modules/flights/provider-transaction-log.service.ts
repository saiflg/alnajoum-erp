import { Injectable } from '@nestjs/common';
import {
  FlightProviderName,
  ProviderOperation,
  ProviderTransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface LogEntryInput {
  provider: FlightProviderName;
  operation: ProviderOperation;
  status: ProviderTransactionStatus;
  bookingId?: string;
  requestId?: string;
  responseId?: string;
  errorCode?: string;
  safeMessage?: string;
}

/**
 * Every provider round-trip, for spec #24 ("Provider Logging") and the
 * admin dashboard's Provider Success Rate / Provider Errors report.
 * `safeMessage` is the only free-text field — callers must pass a
 * sanitized, human-readable summary, never a raw request/response body
 * (which could carry API secrets or passenger PII). Never throws: a
 * logging failure must never fail the booking operation it's describing.
 */
@Injectable()
export class ProviderTransactionLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: LogEntryInput): Promise<void> {
    try {
      await this.prisma.providerTransactionLog.create({ data: entry });
    } catch {
      // Deliberately swallowed — see class doc comment.
    }
  }

  listAll(filters: { provider?: FlightProviderName; bookingId?: string }) {
    return this.prisma.providerTransactionLog.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async successRateByProvider(): Promise<
    Array<{
      provider: FlightProviderName;
      total: number;
      successful: number;
      successRate: number;
    }>
  > {
    const rows = await this.prisma.providerTransactionLog.groupBy({
      by: ['provider', 'status'],
      _count: { _all: true },
    });

    const byProvider = new Map<
      FlightProviderName,
      { total: number; successful: number }
    >();
    for (const row of rows) {
      const entry = byProvider.get(row.provider) ?? { total: 0, successful: 0 };
      entry.total += row._count._all;
      if (row.status === ProviderTransactionStatus.SUCCESS) {
        entry.successful += row._count._all;
      }
      byProvider.set(row.provider, entry);
    }

    return Array.from(byProvider.entries()).map(
      ([provider, { total, successful }]) => ({
        provider,
        total,
        successful,
        successRate:
          total === 0 ? 0 : Math.round((successful / total) * 1000) / 10,
      }),
    );
  }
}
