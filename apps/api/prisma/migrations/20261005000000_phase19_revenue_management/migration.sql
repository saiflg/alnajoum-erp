-- Phase 19: Revenue management foundation
-- Versioned pricing rules, margin policy, stored price traces (booking snapshots),
-- and promotions with atomic usage tracking. Additive only.

-- CreateEnum
CREATE TYPE "PricingTier" AS ENUM ('CONTRACT', 'PRODUCT', 'SEGMENT', 'CAMPAIGN', 'CHANNEL');

-- CreateEnum
CREATE TYPE "PromotionMode" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "tier" "PricingTier" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "conditions" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rule_versions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeReason" TEXT,
    "changedByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_policies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "minAbsoluteMargin" INTEGER,
    "minPercentMargin" DOUBLE PRECISION,
    "maxDiscountPercent" DOUBLE PRECISION,
    "productOverrides" JSONB,
    "updatedByIdentityId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_traces" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "product" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "currency" TEXT NOT NULL,
    "supplierCost" INTEGER NOT NULL,
    "customerPrice" INTEGER NOT NULL,
    "margin" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "trace" JSONB NOT NULL,
    "appliedRules" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "overrideApprovedBy" TEXT,
    "overrideReason" TEXT,
    "createdByIdentityId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "mode" "PromotionMode" NOT NULL,
    "value" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "products" TEXT[],
    "channels" TEXT[],
    "minBookingAmount" INTEGER,
    "maxDiscountAmount" INTEGER,
    "totalUsageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "budget" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "budgetUsed" INTEGER NOT NULL DEFAULT 0,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_usages" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "customerId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pricing_rules_companyId_isActive_idx" ON "pricing_rules"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "pricing_rules_tier_priority_idx" ON "pricing_rules"("tier", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rule_versions_ruleId_version_key" ON "pricing_rule_versions"("ruleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_policies_companyId_key" ON "pricing_policies"("companyId");

-- CreateIndex
CREATE INDEX "pricing_traces_companyId_calculatedAt_idx" ON "pricing_traces"("companyId", "calculatedAt");

-- CreateIndex
CREATE INDEX "pricing_traces_sourceType_sourceId_idx" ON "pricing_traces"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "promotions_companyId_isActive_idx" ON "promotions"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_companyId_code_key" ON "promotions"("companyId", "code");

-- CreateIndex
CREATE INDEX "promotion_usages_promotionId_customerId_idx" ON "promotion_usages"("promotionId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_usages_promotionId_sourceType_sourceId_key" ON "promotion_usages"("promotionId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rule_versions" ADD CONSTRAINT "pricing_rule_versions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "pricing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_policies" ADD CONSTRAINT "pricing_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_traces" ADD CONSTRAINT "pricing_traces_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
