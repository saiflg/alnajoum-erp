import { Injectable, Logger } from '@nestjs/common';
import {
  FlightBookingStatus,
  IncentiveStatus,
  SupplierPayableStatus,
  VisaDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import {
  buildRegistryPrompt,
  coerceParams,
  findQuerySpec,
} from './analytics-query-registry';
import { AiUsageService } from './ai-usage.service';
import { AiProviderRouter } from './providers/ai-provider.router';
import type { AiCompletionResult } from './providers/ai-provider.port';

const SYSTEM_PROMPT_PREFIX = `You are the analytics assistant for a travel agency ERP. Given the user's question, choose the single best-matching query from this exact list, or "query": null if none genuinely matches. Respond with ONLY a JSON object shaped exactly like {"query": "<name-or-null>", "params": {"<param>": <number>}}. Never invent a query name that isn't listed below. Never include any field in "params" that isn't listed for that query.

Available queries:
`;

export interface AskAnalyticsResult {
  matched: boolean;
  query?: string;
  params?: Record<string, number>;
  summary: string;
  data?: Record<string, unknown>;
  provider: string;
}

/**
 * Phase 13 spec #7/#8/#31 — natural-language business analytics for
 * authorized admins. The AI's role is strictly limited to picking a
 * query name + params from ANALYTICS_QUERY_REGISTRY (an allowlist enforced
 * again here, independent of what the provider returns) — every actual
 * number in a response comes from a real Prisma query below, tenant-
 * scoped exactly like every other read in this codebase, never from the
 * model. The final answer sentence is built by plain string
 * interpolation over those real numbers, not a second AI call, so there
 * is no step where the model could alter a figure it already computed
 * correctly — satisfies spec #7/#20's "do not fabricate numbers" and
 * spec #36's source-aware answers (the `data` field carries the same
 * numbers the summary sentence quotes, for the frontend to render/cite
 * directly).
 */
@Injectable()
export class AiAnalyticsService {
  private readonly logger = new Logger(AiAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProviderRouter: AiProviderRouter,
    private readonly usageService: AiUsageService,
  ) {}

  async ask(question: string, user: AuthContext): Promise<AskAnalyticsResult> {
    const tenantCompanyId = resolveTenantFilter(user);
    const companyId = user.companyId ?? undefined;
    await this.usageService.enforceDailyLimit(companyId);

    let completion: AiCompletionResult;
    try {
      completion = await this.aiProviderRouter.complete({
        system: SYSTEM_PROMPT_PREFIX + buildRegistryPrompt(),
        prompt: question,
        jsonMode: true,
        temperature: 0,
      });
    } catch (error) {
      await this.usageService.log({
        identityId: user.sub,
        companyId,
        requestType: 'analytics_query',
        provider: 'unknown',
        question: question.slice(0, 500),
        status: 'ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const selection = this.parseSelection(completion.text);
    const spec = selection?.query ? findQuerySpec(selection.query) : undefined;

    if (!selection || !spec) {
      await this.usageService.log({
        identityId: user.sub,
        companyId,
        requestType: 'analytics_query',
        provider: completion.provider,
        model: completion.model,
        question: question.slice(0, 500),
        status: 'UNMATCHED',
      });
      return {
        matched: false,
        provider: completion.provider,
        summary:
          "I couldn't match that to one of the reports I know. Try asking about ticket sales, top routes, supplier liabilities, pending incentives, visas expiring soon, branch sales, or cancelled bookings.",
      };
    }

    const params = coerceParams(spec, selection.params);
    const { summary, data } = await this.execute(
      spec.name,
      params,
      tenantCompanyId,
    );

    await this.usageService.log({
      identityId: user.sub,
      companyId,
      requestType: 'analytics_query',
      provider: completion.provider,
      model: completion.model,
      question: question.slice(0, 500),
      matchedQuery: spec.name,
      status: 'MATCHED',
    });

    return {
      matched: true,
      query: spec.name,
      params,
      summary,
      data,
      provider: completion.provider,
    };
  }

  private parseSelection(
    text: string,
  ): { query: string | null; params?: Record<string, unknown> } | null {
    try {
      const parsed = JSON.parse(text) as {
        query?: string | null;
        params?: Record<string, unknown>;
      };
      if (parsed.query === null || parsed.query === undefined) {
        return { query: null };
      }
      if (typeof parsed.query !== 'string') return null;
      return { query: parsed.query, params: parsed.params };
    } catch {
      this.logger.warn(
        `AI provider returned non-JSON selection: ${text.slice(0, 200)}`,
      );
      return null;
    }
  }

  private async execute(
    queryName: string,
    params: Record<string, number>,
    tenantCompanyId: string | undefined,
  ): Promise<{ summary: string; data: Record<string, unknown> }> {
    switch (queryName) {
      case 'total_ticket_sales':
        return this.totalTicketSales(params.days, tenantCompanyId);
      case 'top_routes_by_revenue':
        return this.topRoutesByRevenue(
          params.days,
          params.limit,
          tenantCompanyId,
        );
      case 'supplier_liabilities':
        return this.supplierLiabilities(tenantCompanyId);
      case 'pending_incentives':
        return this.pendingIncentives(tenantCompanyId);
      case 'visas_expiring_soon':
        return this.visasExpiringSoon(params.days, tenantCompanyId);
      case 'branch_sales':
        return this.branchSales(params.days, params.limit, tenantCompanyId);
      case 'cancelled_bookings_count':
        return this.cancelledBookingsCount(params.days, tenantCompanyId);
      default:
        // Unreachable: queryName is only ever a name already validated
        // against the registry by findQuerySpec() in ask() above.
        throw new Error(`Unhandled analytics query: ${queryName}`);
    }
  }

  private since(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private async totalTicketSales(days: number, tenantCompanyId?: string) {
    const result = await this.prisma.flightBooking.aggregate({
      where: {
        createdAt: { gte: this.since(days) },
        status: {
          in: [FlightBookingStatus.CONFIRMED, FlightBookingStatus.TICKETED],
        },
        ...(tenantCompanyId !== undefined && {
          customer: { companyId: tenantCompanyId },
        }),
      },
      _sum: { totalAmount: true },
      _count: true,
    });
    const total = result._sum.totalAmount ?? 0;
    return {
      summary: `Total flight ticket sales over the last ${days} day(s): ₦${total.toLocaleString()} across ${result._count} booking(s).`,
      data: {
        days,
        totalAmount: total,
        currency: 'NGN',
        bookingCount: result._count,
      },
    };
  }

  private async topRoutesByRevenue(
    days: number,
    limit: number,
    tenantCompanyId?: string,
  ) {
    const rows = await this.prisma.flightBooking.groupBy({
      by: ['origin', 'destination'],
      where: {
        createdAt: { gte: this.since(days) },
        status: {
          in: [FlightBookingStatus.CONFIRMED, FlightBookingStatus.TICKETED],
        },
        ...(tenantCompanyId !== undefined && {
          customer: { companyId: tenantCompanyId },
        }),
      },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: limit,
    });
    const routes = rows.map((r) => ({
      route: `${r.origin} → ${r.destination}`,
      revenue: r._sum.totalAmount ?? 0,
    }));
    const summary =
      routes.length === 0
        ? `No flight bookings in the last ${days} day(s).`
        : `Top route(s) by revenue over the last ${days} day(s): ` +
          routes
            .map((r) => `${r.route} (₦${r.revenue.toLocaleString()})`)
            .join(', ') +
          '.';
    return { summary, data: { days, routes } };
  }

  private async supplierLiabilities(tenantCompanyId?: string) {
    const rows = await this.prisma.supplierPayable.findMany({
      where: {
        status: {
          in: [
            SupplierPayableStatus.OUTSTANDING,
            SupplierPayableStatus.PARTIALLY_PAID,
            SupplierPayableStatus.OVERDUE,
          ],
        },
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      select: { amount: true, amountPaid: true },
    });
    const totalOwed = rows.reduce(
      (sum, r) => sum + (r.amount - r.amountPaid),
      0,
    );
    return {
      summary: `Current outstanding supplier liabilities: ₦${totalOwed.toLocaleString()} across ${rows.length} payable(s).`,
      data: { totalOwed, currency: 'NGN', payableCount: rows.length },
    };
  }

  private async pendingIncentives(tenantCompanyId?: string) {
    const result = await this.prisma.staffIncentive.aggregate({
      where: {
        status: IncentiveStatus.APPROVED,
        ...(tenantCompanyId !== undefined && {
          staff: { companyId: tenantCompanyId },
        }),
      },
      _sum: { amount: true },
      _count: true,
    });
    const total = result._sum.amount ?? 0;
    return {
      summary: `Pending staff incentives (approved, not yet paid out): ₦${total.toLocaleString()} across ${result._count} incentive(s).`,
      data: {
        totalAmount: total,
        currency: 'NGN',
        incentiveCount: result._count,
      },
    };
  }

  private async visasExpiringSoon(days: number, tenantCompanyId?: string) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const count = await this.prisma.visaDocument.count({
      where: {
        expiryDate: { not: null, lte: cutoff, gte: now },
        status: { not: VisaDocumentStatus.EXPIRED },
        ...(tenantCompanyId !== undefined && {
          OR: [
            { application: { customer: { companyId: tenantCompanyId } } },
            {
              guarantor: {
                application: { customer: { companyId: tenantCompanyId } },
              },
            },
          ],
        }),
      },
    });
    return {
      summary: `${count} visa document(s) are expiring within the next ${days} day(s).`,
      data: { days, count },
    };
  }

  private async branchSales(
    days: number,
    limit: number,
    tenantCompanyId?: string,
  ) {
    const rows = await this.prisma.flightBooking.groupBy({
      by: ['branchId'],
      where: {
        createdAt: { gte: this.since(days) },
        status: {
          in: [FlightBookingStatus.CONFIRMED, FlightBookingStatus.TICKETED],
        },
        branchId: { not: null },
        ...(tenantCompanyId !== undefined && {
          customer: { companyId: tenantCompanyId },
        }),
      },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: limit,
    });
    const branchIds = rows
      .map((r) => r.branchId)
      .filter((id): id is string => id !== null);
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(branches.map((b) => [b.id, b.name]));
    const results = rows.map((r) => ({
      branch: nameById.get(r.branchId!) ?? 'Unknown branch',
      revenue: r._sum.totalAmount ?? 0,
    }));
    const summary =
      results.length === 0
        ? `No branch-attributed flight sales in the last ${days} day(s).`
        : `Top branch(es) by flight sales over the last ${days} day(s): ` +
          results
            .map((r) => `${r.branch} (₦${r.revenue.toLocaleString()})`)
            .join(', ') +
          '.';
    return { summary, data: { days, branches: results } };
  }

  private async cancelledBookingsCount(days: number, tenantCompanyId?: string) {
    // FlightBooking has no dedicated cancelledAt column — updatedAt is the
    // best available proxy for "when the cancellation happened", since a
    // booking's status only flips to CANCELLED once, and that flip is
    // exactly what bumps updatedAt.
    const count = await this.prisma.flightBooking.count({
      where: {
        status: FlightBookingStatus.CANCELLED,
        updatedAt: { gte: this.since(days) },
        ...(tenantCompanyId !== undefined && {
          customer: { companyId: tenantCompanyId },
        }),
      },
    });
    return {
      summary: `${count} flight booking(s) were cancelled in the last ${days} day(s).`,
      data: { days, count },
    };
  }
}
