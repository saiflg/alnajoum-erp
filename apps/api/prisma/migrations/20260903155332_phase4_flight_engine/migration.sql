-- CreateEnum
CREATE TYPE "FlightRefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FlightReissueStatus" AS ENUM ('REQUESTED', 'AWAITING_PAYMENT', 'PAID', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FlightPricingRuleType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "FlightGroupBookingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProviderOperation" AS ENUM ('SEARCH', 'GET_OFFER', 'CREATE_ORDER', 'ISSUE_TICKET', 'CANCEL_ORDER', 'REFUND', 'REISSUE');

-- CreateEnum
CREATE TYPE "ProviderTransactionStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FlightBookingStatus" ADD VALUE 'TICKETED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'REFUND_REQUESTED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'REISSUE_REQUESTED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'REISSUED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FlightProviderName" ADD VALUE 'TRAVELPORT';
ALTER TYPE "FlightProviderName" ADD VALUE 'TBO';

-- AlterTable
ALTER TABLE "flight_bookings" ADD COLUMN     "baggageAllowance" JSONB,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "fareRules" JSONB,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "markupAmount" INTEGER,
ADD COLUMN     "pnr" TEXT,
ADD COLUMN     "pricingRuleId" TEXT,
ADD COLUMN     "providerCost" INTEGER,
ADD COLUMN     "providerWarnings" JSONB,
ADD COLUMN     "refundable" BOOLEAN,
ADD COLUMN     "ticketedAt" TIMESTAMP(3),
ADD COLUMN     "ticketedByStaffId" TEXT;

-- CreateTable
CREATE TABLE "flight_refunds" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "requestedByStaffId" TEXT,
    "requestedByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "ticketPrice" INTEGER NOT NULL,
    "providerPenalty" INTEGER NOT NULL DEFAULT 0,
    "agencyFee" INTEGER NOT NULL DEFAULT 0,
    "refundableTaxes" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "FlightRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "flight_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_reissues" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "requestedByStaffId" TEXT,
    "originalOfferSnapshot" JSONB NOT NULL,
    "newOfferSnapshot" JSONB NOT NULL,
    "fareDifference" INTEGER NOT NULL,
    "changePenalty" INTEGER NOT NULL DEFAULT 0,
    "totalDue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "FlightReissueStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "flight_reissues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_pricing_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FlightPricingRuleType" NOT NULL,
    "amount" INTEGER,
    "percent" DOUBLE PRECISION,
    "airlineCode" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "cabinClass" "CabinClass",
    "staffId" TEXT,
    "branchId" TEXT,
    "isPromotional" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "incentivePolicyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_group_bookings" (
    "id" TEXT NOT NULL,
    "groupReference" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "groupContactName" TEXT NOT NULL,
    "groupContactPhone" TEXT NOT NULL,
    "groupContactEmail" TEXT,
    "numberOfPassengers" INTEGER NOT NULL,
    "origin" TEXT,
    "destination" TEXT NOT NULL,
    "travelDate" TIMESTAMP(3) NOT NULL,
    "airline" TEXT,
    "negotiatedPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL,
    "status" "FlightGroupBookingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByStaffId" TEXT,
    "branchId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_group_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_group_passengers" (
    "id" TEXT NOT NULL,
    "groupBookingId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "passportNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_group_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_transaction_logs" (
    "id" TEXT NOT NULL,
    "provider" "FlightProviderName" NOT NULL,
    "operation" "ProviderOperation" NOT NULL,
    "requestId" TEXT,
    "responseId" TEXT,
    "bookingId" TEXT,
    "status" "ProviderTransactionStatus" NOT NULL,
    "errorCode" TEXT,
    "safeMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_transaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flight_refunds_bookingId_idx" ON "flight_refunds"("bookingId");

-- CreateIndex
CREATE INDEX "flight_reissues_bookingId_idx" ON "flight_reissues"("bookingId");

-- CreateIndex
CREATE INDEX "flight_pricing_rules_isActive_idx" ON "flight_pricing_rules"("isActive");

-- CreateIndex
CREATE INDEX "flight_pricing_rules_priority_idx" ON "flight_pricing_rules"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "flight_group_bookings_groupReference_key" ON "flight_group_bookings"("groupReference");

-- CreateIndex
CREATE UNIQUE INDEX "flight_group_bookings_invoiceId_key" ON "flight_group_bookings"("invoiceId");

-- CreateIndex
CREATE INDEX "flight_group_passengers_groupBookingId_idx" ON "flight_group_passengers"("groupBookingId");

-- CreateIndex
CREATE INDEX "provider_transaction_logs_provider_idx" ON "provider_transaction_logs"("provider");

-- CreateIndex
CREATE INDEX "provider_transaction_logs_bookingId_idx" ON "provider_transaction_logs"("bookingId");

-- CreateIndex
CREATE INDEX "provider_transaction_logs_createdAt_idx" ON "provider_transaction_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "flight_bookings_idempotencyKey_key" ON "flight_bookings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "flight_bookings_branchId_idx" ON "flight_bookings"("branchId");

-- CreateIndex
CREATE INDEX "flight_bookings_pricingRuleId_idx" ON "flight_bookings"("pricingRuleId");

-- AddForeignKey
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "flight_pricing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_ticketedByStaffId_fkey" FOREIGN KEY ("ticketedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_refunds" ADD CONSTRAINT "flight_refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_refunds" ADD CONSTRAINT "flight_refunds_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_reissues" ADD CONSTRAINT "flight_reissues_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_reissues" ADD CONSTRAINT "flight_reissues_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_pricing_rules" ADD CONSTRAINT "flight_pricing_rules_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_pricing_rules" ADD CONSTRAINT "flight_pricing_rules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_pricing_rules" ADD CONSTRAINT "flight_pricing_rules_incentivePolicyId_fkey" FOREIGN KEY ("incentivePolicyId") REFERENCES "incentive_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_group_bookings" ADD CONSTRAINT "flight_group_bookings_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_group_bookings" ADD CONSTRAINT "flight_group_bookings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_group_bookings" ADD CONSTRAINT "flight_group_bookings_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_group_passengers" ADD CONSTRAINT "flight_group_passengers_groupBookingId_fkey" FOREIGN KEY ("groupBookingId") REFERENCES "flight_group_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_transaction_logs" ADD CONSTRAINT "provider_transaction_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

