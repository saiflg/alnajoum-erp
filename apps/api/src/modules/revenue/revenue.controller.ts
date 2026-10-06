import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import {
  PromotionCheckDto,
  RedeemPromotionDto,
  UpdatePromotionDto,
} from './dto/update-promotion.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { UpsertPricingPolicyDto } from './dto/upsert-pricing-policy.dto';
import { PricingPolicyService } from './pricing-policy.service';
import { PricingRulesService } from './pricing-rules.service';
import { PromotionsService } from './promotions.service';
import { RevenueService } from './revenue.service';

/** A caller with no company who is not the super admin has no tenant to act for. */
function requireTenant(user: AuthContext): string | undefined {
  const tenant = resolveTenantFilter(user);
  if (tenant === '__no_tenant__')
    throw new ForbiddenException('Your account is not attached to a company');
  return tenant;
}

/** For things that must belong to exactly one tenant (promotions): the super admin has none to attribute them to. */
function requireOwnTenant(user: AuthContext): string {
  const tenant = requireTenant(user);
  if (tenant === undefined) {
    throw new BadRequestException(
      'The super admin has no single tenant here — sign in as a tenant admin instead.',
    );
  }
  return tenant;
}

/**
 * Phase 19 revenue-management API. Every route is permission-gated; nothing
 * here accepts a final price from a client. Responses on the pricing routes
 * include supplier cost and margin, which is why REVENUE.PRICING_VIEW is a
 * staff-only permission.
 */
@Controller('revenue')
export class RevenueController {
  constructor(
    private readonly revenueService: RevenueService,
    private readonly rulesService: PricingRulesService,
    private readonly policyService: PricingPolicyService,
    private readonly promotionsService: PromotionsService,
  ) {}

  // ---- Price calculation

  @Post('price/preview')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  preview(@CurrentUser() user: AuthContext, @Body() dto: CalculatePriceDto) {
    requireTenant(user);
    return this.revenueService.calculate({ ...dto, persist: false }, user);
  }

  @Post('price/calculate')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  calculate(@CurrentUser() user: AuthContext, @Body() dto: CalculatePriceDto) {
    requireTenant(user);
    return this.revenueService.calculate(dto, user);
  }

  @Get('traces/:id')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  trace(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    requireTenant(user);
    return this.revenueService.getTrace(id, user);
  }

  // ---- Rules

  @Get('rules')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  listRules(
    @CurrentUser() user: AuthContext,
    @Query('isActive') isActive?: string,
  ) {
    return this.rulesService.list(requireTenant(user), {
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Post('rules')
  @RequirePermissions(PERMISSIONS.REVENUE.RULE_MANAGE)
  createRule(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreatePricingRuleDto,
  ) {
    const tenant = requireTenant(user);
    // undefined tenant = super admin: creates a platform-wide default (companyId null).
    return this.rulesService.create(dto, tenant ?? null, user.sub);
  }

  @Get('rules/:id')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  getRule(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.rulesService.get(id, requireTenant(user));
  }

  @Get('rules/:id/versions')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  ruleVersions(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.rulesService.versions(id, requireTenant(user));
  }

  @Patch('rules/:id')
  @RequirePermissions(PERMISSIONS.REVENUE.RULE_MANAGE)
  updateRule(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdatePricingRuleDto,
  ) {
    return this.rulesService.update(id, dto, requireTenant(user), user.sub);
  }

  // ---- Margin policy

  @Get('policy')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  async getPolicy(@CurrentUser() user: AuthContext) {
    return this.policyService.getRow(requireTenant(user) ?? null);
  }

  @Put('policy')
  @RequirePermissions(PERMISSIONS.REVENUE.POLICY_MANAGE)
  upsertPolicy(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpsertPricingPolicyDto,
  ) {
    return this.policyService.upsert(
      dto,
      requireTenant(user) ?? null,
      user.sub,
    );
  }

  // ---- Promotions and coupons

  @Get('promotions')
  @RequirePermissions(PERMISSIONS.REVENUE.PROMOTION_MANAGE)
  listPromotions(@CurrentUser() user: AuthContext) {
    return this.promotionsService.list(requireTenant(user));
  }

  @Post('promotions')
  @RequirePermissions(PERMISSIONS.REVENUE.PROMOTION_MANAGE)
  createPromotion(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreatePromotionDto,
  ) {
    return this.promotionsService.create(dto, requireOwnTenant(user), user.sub);
  }

  @Patch('promotions/:id')
  @RequirePermissions(PERMISSIONS.REVENUE.PROMOTION_MANAGE)
  updatePromotion(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.promotionsService.update(
      id,
      dto,
      requireTenant(user),
      user.sub,
    );
  }

  @Post('promotions/check')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  checkPromotion(
    @CurrentUser() user: AuthContext,
    @Body() dto: PromotionCheckDto,
  ) {
    return this.promotionsService.check(dto, requireOwnTenant(user));
  }

  @Post('promotions/redeem')
  @RequirePermissions(PERMISSIONS.REVENUE.PRICING_VIEW)
  redeemPromotion(
    @CurrentUser() user: AuthContext,
    @Body() dto: RedeemPromotionDto,
  ) {
    return this.promotionsService.redeem(dto, requireOwnTenant(user), user.sub);
  }
}
