import { toJsonValue } from '../../common/utils/json.util';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarginPolicy } from './engine/pricing.types';
import { UpsertPricingPolicyDto } from './dto/upsert-pricing-policy.dto';

interface ProductOverride {
  minAbsolute?: number;
  minPercent?: number;
  maxDiscountPercent?: number;
}

function validateOverrides(
  raw: Record<string, unknown> | undefined,
): Record<string, ProductOverride> | undefined {
  if (raw === undefined) return undefined;
  const out: Record<string, ProductOverride> = {};
  for (const [product, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(
        `productOverrides.${product} must be an object`,
      );
    }
    const o = value as Record<string, unknown>;
    const entry: ProductOverride = {};
    for (const [k, max] of [
      ['minAbsolute', Infinity],
      ['minPercent', 100],
      ['maxDiscountPercent', 100],
    ] as const) {
      if (o[k] === undefined) continue;
      const n = o[k];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) {
        throw new BadRequestException(
          `productOverrides.${product}.${k} must be a non-negative number${max === 100 ? ' up to 100' : ''}`,
        );
      }
      entry[k] = n;
    }
    out[product.toUpperCase()] = entry;
  }
  return out;
}

/**
 * Margin floors and discount ceilings. A tenant's own policy beats the
 * platform default (companyId null); a product override beats both for that
 * product. With no policy at all there are simply no configured floors — the
 * engine's built-in NEGATIVE_MARGIN safety check still applies.
 */
@Injectable()
export class PricingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getRow(companyId: string | null) {
    return this.prisma.pricingPolicy.findFirst({ where: { companyId } });
  }

  async effectivePolicy(
    companyId: string | null,
    product: string,
  ): Promise<MarginPolicy | undefined> {
    const tenant = companyId ? await this.getRow(companyId) : null;
    const platform = await this.getRow(null);
    const base = tenant ?? platform;
    if (!base) return undefined;

    const overrides = (base.productOverrides ?? {}) as Record<
      string,
      ProductOverride
    >;
    const o = overrides[product.toUpperCase()] ?? {};
    return {
      minAbsolute: o.minAbsolute ?? base.minAbsoluteMargin ?? undefined,
      minPercent: o.minPercent ?? base.minPercentMargin ?? undefined,
      maxDiscountPercent:
        o.maxDiscountPercent ?? base.maxDiscountPercent ?? undefined,
    };
  }

  async upsert(
    dto: UpsertPricingPolicyDto,
    companyId: string | null,
    actorIdentityId: string,
  ) {
    const overrides = validateOverrides(dto.productOverrides);
    const existing = await this.getRow(companyId);
    const data = {
      minAbsoluteMargin: dto.minAbsoluteMargin ?? null,
      minPercentMargin: dto.minPercentMargin ?? null,
      maxDiscountPercent: dto.maxDiscountPercent ?? null,
      productOverrides: (overrides ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      updatedByIdentityId: actorIdentityId,
    };
    const saved = existing
      ? await this.prisma.pricingPolicy.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.pricingPolicy.create({
          data: { companyId, ...data },
        });

    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'revenue.policy_updated',
      entityType: 'PricingPolicy',
      entityId: saved.id,
      companyId: companyId ?? undefined,
      previousValue: existing ? toJsonValue(existing) : undefined,
      newValue: toJsonValue(saved),
    });
    return saved;
  }
}
