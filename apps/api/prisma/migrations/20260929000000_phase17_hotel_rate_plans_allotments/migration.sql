-- Phase 17: Hotel rate-plan and allotment inventory
-- Adds tenant-scoped negotiated rate plans and day-level room allotments for
-- the CATALOG hotel provider, plus a flag on HotelBooking recording whether
-- a booking claimed an allotment night at creation time.

-- AlterTable
ALTER TABLE "hotel_bookings" ADD COLUMN     "usedAllotment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "mealPlan" "MealPlan" NOT NULL DEFAULT 'ROOM_ONLY',
    "occupancy" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "netPrice" INTEGER NOT NULL,
    "grossPrice" INTEGER,
    "commissionPercent" DOUBLE PRECISION,
    "taxPercent" DOUBLE PRECISION,
    "feeAmount" INTEGER,
    "markupPercent" DOUBLE PRECISION,
    "cancellationPolicy" TEXT,
    "changePolicy" TEXT,
    "minStay" INTEGER,
    "maxStay" INTEGER,
    "advancePurchaseDays" INTEGER,
    "releasePeriodDays" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_allotments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalAllocated" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "heldCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "stopSell" BOOLEAN NOT NULL DEFAULT false,
    "releaseDate" TIMESTAMP(3),
    "autoReleased" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_allotments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_plans_companyId_idx" ON "rate_plans"("companyId");

-- CreateIndex
CREATE INDEX "rate_plans_roomTypeId_idx" ON "rate_plans"("roomTypeId");

-- CreateIndex
CREATE INDEX "rate_plans_companyId_roomTypeId_idx" ON "rate_plans"("companyId", "roomTypeId");

-- CreateIndex
CREATE INDEX "rate_plans_isActive_idx" ON "rate_plans"("isActive");

-- CreateIndex
CREATE INDEX "hotel_allotments_companyId_roomTypeId_idx" ON "hotel_allotments"("companyId", "roomTypeId");

-- CreateIndex
CREATE INDEX "hotel_allotments_date_idx" ON "hotel_allotments"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_allotments_companyId_roomTypeId_date_key" ON "hotel_allotments"("companyId", "roomTypeId", "date");

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_allotments" ADD CONSTRAINT "hotel_allotments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_allotments" ADD CONSTRAINT "hotel_allotments_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
