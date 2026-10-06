import { toJsonValue } from '../../common/utils/json.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Promotion } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import {
  PromotionCheckDto,
  RedeemPromotionDto,
  UpdatePromotionDto,
} from './dto/update-promotion.dto';
import {
  evaluatePromotion,
  PromotionEvaluation,
  PromotionSnapshot,
} from './engine/promotion-evaluator';

function snapshot(p: Promotion): PromotionSnapshot {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    mode: p.mode,
    value: p.value,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    isActive: p.isActive,
    products: p.products,
    channels: p.channels,
    minBookingAmount: p.minBookingAmount,
    maxDiscountAmount: p.maxDiscountAmount,
    totalUsageLimit: p.totalUsageLimit,
    perCustomerLimit: p.perCustomerLimit,
    budget: p.budget,
    usedCount: p.usedCount,
    budgetUsed: p.budgetUsed,
  };
}

/**
 * Promotions and coupons. Everything is validated server-side with the same
 * pure evaluator the pricing engine path uses. Redemption is atomic: the
 * promotion row is locked (SELECT ... FOR UPDATE) for the whole transaction, so
 * two simultaneous redemptions of the last coupon are serialised and the second
 * sees the first's usage. The unique (promotion, sourceType, sourceId) key makes
 * redeeming the same booking twice idempotent.
 *
 * Tenancy: a promotion belongs to one company and is looked up with that
 * companyId, so a code from one tenant can never be used in another.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(tenantCompanyId: string | undefined) {
    return this.prisma.promotion.findMany({
      where:
        tenantCompanyId !== undefined ? { companyId: tenantCompanyId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, tenantCompanyId: string | undefined) {
    const promo = await this.prisma.promotion.findUnique({ where: { id } });
    if (
      !promo ||
      (tenantCompanyId !== undefined && promo.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Promotion not found');
    }
    return promo;
  }

  async create(
    dto: CreatePromotionDto,
    companyId: string,
    actorIdentityId: string,
  ) {
    if (dto.endsAt <= dto.startsAt)
      throw new BadRequestException('endsAt must be after startsAt');
    if (dto.mode === 'PERCENT' && dto.value > 100)
      throw new BadRequestException(
        'A percentage promotion cannot exceed 100%',
      );
    const code = dto.code?.trim().toUpperCase();
    if (code) {
      const clash = await this.prisma.promotion.findFirst({
        where: { companyId, code },
      });
      if (clash)
        throw new ConflictException(
          'A promotion with this code already exists',
        );
    }
    const promo = await this.prisma.promotion.create({
      data: {
        companyId,
        name: dto.name,
        code: code ?? null,
        mode: dto.mode,
        value: dto.value,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        isActive: dto.isActive ?? true,
        products: (dto.products ?? []).map((p) => p.toUpperCase()),
        channels: (dto.channels ?? []).map((c) => c.toUpperCase()),
        minBookingAmount: dto.minBookingAmount,
        maxDiscountAmount: dto.maxDiscountAmount,
        totalUsageLimit: dto.totalUsageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        budget: dto.budget,
        createdByIdentityId: actorIdentityId,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'revenue.promotion_created',
      entityType: 'Promotion',
      entityId: promo.id,
      companyId,
      newValue: toJsonValue(promo),
    });
    return promo;
  }

  async update(
    id: string,
    dto: UpdatePromotionDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    const updated = await this.prisma.promotion.update({
      where: { id },
      data: {
        ...dto,
        products: dto.products?.map((p) => p.toUpperCase()),
        channels: dto.channels?.map((c) => c.toUpperCase()),
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'revenue.promotion_updated',
      entityType: 'Promotion',
      entityId: id,
      companyId: existing.companyId,
      previousValue: toJsonValue(existing),
      newValue: toJsonValue(updated),
    });
    return updated;
  }

  /** Eligibility check with no side effects — what a checkout shows before the customer commits. */
  async check(
    dto: PromotionCheckDto,
    companyId: string,
  ): Promise<PromotionEvaluation & { promotionId?: string }> {
    const code = dto.code?.trim().toUpperCase();
    if (!code) return { eligible: false, reason: 'CODE_REQUIRED' };
    const promo = await this.prisma.promotion.findFirst({
      where: { companyId, code },
    });
    // A code that doesn't exist for this tenant looks identical to a wrong code — no enumeration.
    if (!promo) return { eligible: false, reason: 'CODE_MISMATCH' };

    const customerUsageCount = dto.customerId
      ? await this.prisma.promotionUsage.count({
          where: { promotionId: promo.id, customerId: dto.customerId },
        })
      : 0;
    const result = evaluatePromotion(snapshot(promo), {
      product: dto.product.toUpperCase(),
      channel: dto.channel?.toUpperCase(),
      bookingAmount: dto.bookingAmount,
      presentedCode: code,
      customerUsageCount,
      now: new Date(),
    });
    return { ...result, promotionId: promo.id };
  }

  /**
   * Atomically records a redemption. Returns the existing usage unchanged if this
   * booking already redeemed the promotion (idempotent retry).
   */
  async redeem(
    dto: RedeemPromotionDto,
    companyId: string,
    actorIdentityId: string,
  ) {
    const code = dto.code?.trim().toUpperCase();
    if (!code) throw new BadRequestException('A coupon code is required');
    const promo = await this.prisma.promotion.findFirst({
      where: { companyId, code },
    });
    if (!promo) throw new BadRequestException('This coupon is not valid');

    try {
      const usage = await this.prisma.$transaction(async (tx) => {
        // Serialise every redemption of this promotion.
        await tx.$queryRaw`SELECT id FROM promotions WHERE id = ${promo.id} FOR UPDATE`;

        const already = await tx.promotionUsage.findUnique({
          where: {
            promotionId_sourceType_sourceId: {
              promotionId: promo.id,
              sourceType: dto.sourceType,
              sourceId: dto.sourceId,
            },
          },
        });
        if (already) return already;

        const fresh = await tx.promotion.findUniqueOrThrow({
          where: { id: promo.id },
        });
        const customerUsageCount = dto.customerId
          ? await tx.promotionUsage.count({
              where: { promotionId: promo.id, customerId: dto.customerId },
            })
          : 0;
        const result = evaluatePromotion(snapshot(fresh), {
          product: dto.product.toUpperCase(),
          channel: dto.channel?.toUpperCase(),
          bookingAmount: dto.bookingAmount,
          presentedCode: code,
          customerUsageCount,
          now: new Date(),
        });
        if (!result.eligible)
          throw new ConflictException(
            `This coupon cannot be used (${result.reason})`,
          );

        await tx.promotion.update({
          where: { id: promo.id },
          data: {
            usedCount: { increment: 1 },
            budgetUsed: { increment: result.discountAmount },
          },
        });
        return tx.promotionUsage.create({
          data: {
            promotionId: promo.id,
            customerId: dto.customerId,
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
            discountAmount: result.discountAmount,
          },
        });
      });
      await this.auditService.record({
        identityId: actorIdentityId,
        action: 'revenue.promotion_redeemed',
        entityType: 'Promotion',
        entityId: promo.id,
        companyId,
        metadata: {
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          discountAmount: usage.discountAmount,
        },
      });
      return usage;
    } catch (error) {
      // A concurrent identical redemption lost the unique race: hand back the winner's row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.promotionUsage.findUnique({
          where: {
            promotionId_sourceType_sourceId: {
              promotionId: promo.id,
              sourceType: dto.sourceType,
              sourceId: dto.sourceId,
            },
          },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** Used by RevenueService: the evaluation for a presented code, without recording anything. */
  async evaluateForPricing(
    companyId: string,
    code: string | undefined,
    ctx: {
      product: string;
      channel?: string;
      bookingAmount: number;
      customerId?: string;
    },
  ) {
    if (!code) return null;
    const result = await this.check(
      {
        product: ctx.product,
        channel: ctx.channel,
        bookingAmount: ctx.bookingAmount,
        code,
        customerId: ctx.customerId,
      },
      companyId,
    );
    return result;
  }
}
