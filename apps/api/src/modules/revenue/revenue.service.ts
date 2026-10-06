import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { calculatePrice, PricingEngineError } from './engine/pricing-engine';
import {
  DiscountInput,
  PricingContext,
  PricingResult,
  PricingRuleInput,
} from './engine/pricing.types';
import { toCustomerView } from './engine/price-view';
import { toEngineRule } from './engine/rule-validation';
import { PricingPolicyService } from './pricing-policy.service';
import { PromotionsService } from './promotions.service';

/**
 * Orchestrates one price calculation: tenant-scoped rules + margin policy +
 * an optional coupon, run through the pure engine, optionally frozen as a
 * PricingTrace (the booking's commercial snapshot).
 *
 * The caller supplies the supplier cost, so every endpoint that reaches this is
 * permission-gated (REVENUE.PRICING_VIEW, staff only). A customer-facing flow
 * must resolve the supplier cost on the server from its own offer and return
 * only toCustomerView(...). Nothing here lets a client choose a final price.
 */
@Injectable()
export class RevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: PricingPolicyService,
    private readonly promotionsService: PromotionsService,
    private readonly auditService: AuditService,
  ) {}

  async calculate(
    dto: CalculatePriceDto,
    user: AuthContext,
  ): Promise<{ result: PricingResult; traceId?: string }> {
    const tenant = resolveTenantFilter(user);
    // Only the super admin may price on behalf of a chosen tenant; everyone else is pinned to their own.
    const companyId: string | null =
      tenant !== undefined ? tenant : (dto.companyId ?? null);

    const rows = await this.prisma.pricingRule.findMany({
      where: { isActive: true, OR: [{ companyId }, { companyId: null }] },
    });
    let rules: PricingRuleInput[];
    try {
      rules = rows.map(toEngineRule);
    } catch (error) {
      if (error instanceof PricingEngineError) {
        // A corrupt rule must stop pricing, not be skipped — skipping could silently under-price.
        throw new UnprocessableEntityException(
          `A pricing rule is misconfigured: ${error.message}`,
        );
      }
      throw error;
    }

    const product = dto.product.toUpperCase();
    const marginPolicy = await this.policyService.effectivePolicy(
      companyId,
      product,
    );
    const context: PricingContext = {
      product,
      supplierCost: dto.supplierCost,
      currency: dto.currency.toUpperCase(),
      taxIncludedInSupplierCost: dto.taxIncludedInSupplierCost,
      supplierId: dto.supplierId,
      airlineCode: dto.airlineCode,
      origin: dto.origin,
      destination: dto.destination,
      cabinClass: dto.cabinClass,
      roomType: dto.roomType,
      channel: dto.channel?.toUpperCase(),
      customerSegment: dto.customerSegment,
      corporateAccountId: dto.corporateAccountId,
      agentId: dto.agentId,
      branchId: dto.branchId,
      paymentMethod: dto.paymentMethod,
      passengers: dto.passengers,
      advanceDays: dto.advanceDays,
      daysToDeparture: dto.daysToDeparture,
      inventoryRemainingPercent: dto.inventoryRemainingPercent,
    };
    const now = new Date();

    // A margin override is a privileged act: the caller must hold the permission.
    let override: { approvedBy: string; reason: string } | null = null;
    if (dto.override) {
      if (!user.permissions.includes(PERMISSIONS.REVENUE.PRICE_OVERRIDE)) {
        throw new ForbiddenException(
          'You are not permitted to override margin protection',
        );
      }
      override = { approvedBy: user.sub, reason: dto.override.reason };
    }

    // A presented coupon is evaluated against the pre-discount subtotal, then the price is recomputed with it.
    const extraDiscounts: DiscountInput[] = [];
    if (dto.promotionCode) {
      if (!companyId)
        throw new BadRequestException('Coupons need a tenant context');
      const preview = calculatePrice({ context, rules, marginPolicy, now });
      const evaluation = await this.promotionsService.evaluateForPricing(
        companyId,
        dto.promotionCode,
        {
          product,
          channel: context.channel,
          bookingAmount: preview.breakdown.subtotal,
          customerId: dto.customerId,
        },
      );
      if (!evaluation || !evaluation.eligible) {
        // Fail loudly: a customer who typed a coupon must be told it did not apply.
        throw new BadRequestException(
          `This coupon cannot be applied (${evaluation && !evaluation.eligible ? evaluation.reason : 'INVALID'})`,
        );
      }
      extraDiscounts.push(evaluation.discount);
    }

    let result: PricingResult;
    try {
      result = calculatePrice({
        context,
        rules,
        marginPolicy,
        extraDiscounts,
        override,
        now,
      });
    } catch (error) {
      if (error instanceof PricingEngineError)
        throw new BadRequestException(error.message);
      throw error;
    }

    let traceId: string | undefined;
    if (dto.persist) {
      const row = await this.prisma.pricingTrace.create({
        data: {
          companyId,
          product,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          currency: result.breakdown.currency,
          supplierCost: result.breakdown.supplierCost,
          customerPrice: result.breakdown.customerPrice,
          margin: result.breakdown.margin,
          status: result.status,
          breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
          trace: result.trace as unknown as Prisma.InputJsonValue,
          appliedRules: result.appliedRules,
          engineVersion: result.engineVersion,
          overrideApprovedBy:
            override && result.violations.length > 0
              ? override.approvedBy
              : null,
          overrideReason:
            override && result.violations.length > 0 ? override.reason : null,
          createdByIdentityId: user.sub,
        },
      });
      traceId = row.id;
    }

    if (override && result.violations.length > 0) {
      await this.auditService.record({
        identityId: user.sub,
        action: 'revenue.margin_override_used',
        entityType: 'PricingTrace',
        entityId: traceId,
        companyId: companyId ?? undefined,
        reason: override.reason,
        metadata: {
          violations: result.violations,
          customerPrice: result.breakdown.customerPrice,
          margin: result.breakdown.margin,
        },
      });
    }
    return { result, traceId };
  }

  async getTrace(id: string, user: AuthContext) {
    const tenant = resolveTenantFilter(user);
    const trace = await this.prisma.pricingTrace.findUnique({ where: { id } });
    // NotFound (not Forbidden) so a trace id can't be used to confirm another tenant's data exists.
    if (!trace || (tenant !== undefined && trace.companyId !== tenant)) {
      throw new NotFoundException('Pricing trace not found');
    }
    return trace;
  }

  customerView(result: PricingResult) {
    return toCustomerView(result.breakdown);
  }
}
