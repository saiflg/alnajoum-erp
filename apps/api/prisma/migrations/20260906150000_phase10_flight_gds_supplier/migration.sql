-- CreateEnum
CREATE TYPE "FlightVoidStatus" AS ENUM ('REQUESTED', 'VOIDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FlightAncillaryType" AS ENUM ('BAGGAGE', 'SEAT', 'MEAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FlightAncillaryStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FlightServiceFeeType" AS ENUM ('BOOKING', 'TICKETING', 'CANCELLATION', 'REFUND_PROCESSING', 'REISSUE', 'CHANGE', 'ANCILLARY');

-- CreateEnum
CREATE TYPE "FlightSupplierType" AS ENUM ('GDS', 'NDC', 'LCC', 'CONSOLIDATOR', 'AIRLINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "FlightSupplierStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FlightSupplierContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "FlightWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "FlightScheduleChangeStatus" AS ENUM ('DETECTED', 'CUSTOMER_NOTIFIED', 'ACCEPTED', 'ALTERNATIVE_REQUESTED', 'REFUND_REQUESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FlightBookingStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'HOLD_EXPIRED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'VOID_REQUESTED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'VOIDED';
ALTER TYPE "FlightBookingStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "corporate_accounts" ADD COLUMN     "advanceBookingDays" INTEGER,
ADD COLUMN     "allowedCabinClasses" "CabinClass"[],
ADD COLUMN     "creditLimit" INTEGER,
ADD COLUMN     "maxFareAmount" INTEGER,
ADD COLUMN     "maxFareCurrency" TEXT,
ADD COLUMN     "preferredAirlines" TEXT[],
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "flight_bookings" ADD COLUMN     "corporateAccountId" TEXT,
ADD COLUMN     "corporateApprovalStatus" "ApprovalStatus",
ADD COLUMN     "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN     "isOfflineEntry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offlineReason" TEXT;

-- AlterTable
ALTER TABLE "supplier_payables" ADD COLUMN     "flightSupplierId" TEXT;

-- CreateTable
CREATE TABLE "flight_voids" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "requestedByStaffId" TEXT NOT NULL,
    "ticketNumbers" TEXT[],
    "voidDeadline" TIMESTAMP(3) NOT NULL,
    "amountVoided" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "FlightVoidStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "flight_voids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_ancillaries" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "FlightAncillaryType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "FlightAncillaryStatus" NOT NULL DEFAULT 'REQUESTED',
    "purchasedByStaffId" TEXT,
    "providerReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_ancillaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_service_fees" (
    "id" TEXT NOT NULL,
    "type" "FlightServiceFeeType" NOT NULL,
    "amount" INTEGER,
    "percent" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_service_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_provider_routing_rules" (
    "id" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "providerPriority" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_provider_routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FlightSupplierType" NOT NULL,
    "providerCode" TEXT,
    "apiProvider" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "commissionPercent" DOUBLE PRECISION,
    "markupPercent" DOUBLE PRECISION,
    "serviceFee" INTEGER,
    "creditLimit" INTEGER,
    "paymentTerms" TEXT,
    "settlementCycle" TEXT,
    "status" "FlightSupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "apiStatus" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_supplier_contracts" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "commissionPercent" DOUBLE PRECISION,
    "markupPercent" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "settlementTerms" TEXT,
    "ticketingTerms" TEXT,
    "cancellationRules" TEXT,
    "contactPerson" TEXT,
    "documentUrl" TEXT,
    "status" "FlightSupplierContractStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_supplier_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "FlightProviderName" NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FlightWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "flight_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_schedule_changes" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "oldSegmentSnapshot" JSONB NOT NULL,
    "newSegmentSnapshot" JSONB NOT NULL,
    "status" "FlightScheduleChangeStatus" NOT NULL DEFAULT 'DETECTED',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerNotifiedAt" TIMESTAMP(3),
    "resolvedByStaffId" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "flight_schedule_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flight_voids_bookingId_idx" ON "flight_voids"("bookingId");

-- CreateIndex
CREATE INDEX "flight_ancillaries_bookingId_idx" ON "flight_ancillaries"("bookingId");

-- CreateIndex
CREATE INDEX "flight_service_fees_type_isActive_idx" ON "flight_service_fees"("type", "isActive");

-- CreateIndex
CREATE INDEX "flight_provider_routing_rules_isActive_idx" ON "flight_provider_routing_rules"("isActive");

-- CreateIndex
CREATE INDEX "flight_suppliers_status_idx" ON "flight_suppliers"("status");

-- CreateIndex
CREATE INDEX "flight_supplier_contracts_supplierId_idx" ON "flight_supplier_contracts"("supplierId");

-- CreateIndex
CREATE INDEX "flight_supplier_contracts_status_idx" ON "flight_supplier_contracts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "flight_webhook_events_externalId_key" ON "flight_webhook_events"("externalId");

-- CreateIndex
CREATE INDEX "flight_webhook_events_provider_idx" ON "flight_webhook_events"("provider");

-- CreateIndex
CREATE INDEX "flight_webhook_events_status_idx" ON "flight_webhook_events"("status");

-- CreateIndex
CREATE INDEX "flight_schedule_changes_bookingId_idx" ON "flight_schedule_changes"("bookingId");

-- CreateIndex
CREATE INDEX "flight_schedule_changes_status_idx" ON "flight_schedule_changes"("status");

-- CreateIndex
CREATE INDEX "flight_bookings_corporateAccountId_idx" ON "flight_bookings"("corporateAccountId");

-- CreateIndex
CREATE INDEX "supplier_payables_flightSupplierId_idx" ON "supplier_payables"("flightSupplierId");

-- AddForeignKey
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_corporateAccountId_fkey" FOREIGN KEY ("corporateAccountId") REFERENCES "corporate_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_voids" ADD CONSTRAINT "flight_voids_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_voids" ADD CONSTRAINT "flight_voids_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_ancillaries" ADD CONSTRAINT "flight_ancillaries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_ancillaries" ADD CONSTRAINT "flight_ancillaries_purchasedByStaffId_fkey" FOREIGN KEY ("purchasedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_supplier_contracts" ADD CONSTRAINT "flight_supplier_contracts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "flight_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_webhook_events" ADD CONSTRAINT "flight_webhook_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_schedule_changes" ADD CONSTRAINT "flight_schedule_changes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_schedule_changes" ADD CONSTRAINT "flight_schedule_changes_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_flightSupplierId_fkey" FOREIGN KEY ("flightSupplierId") REFERENCES "flight_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

