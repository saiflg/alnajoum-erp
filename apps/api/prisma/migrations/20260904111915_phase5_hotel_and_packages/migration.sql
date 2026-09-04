
-- CreateEnum
CREATE TYPE "HotelStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MealPlan" AS ENUM ('ROOM_ONLY', 'BED_AND_BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'ALL_INCLUSIVE');

-- CreateEnum
CREATE TYPE "HotelRefundStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PackageComponentType" AS ENUM ('FLIGHT', 'HOTEL', 'VISA', 'TRANSPORT', 'MEALS', 'INSURANCE', 'TOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "TravelPackageCategory" AS ENUM ('ECONOMY', 'STANDARD', 'PREMIUM', 'VIP', 'FAMILY', 'GROUP');

-- AlterEnum
ALTER TYPE "IntegrationCategory" ADD VALUE 'HOTEL';

-- AlterEnum
ALTER TYPE "HotelProviderName" ADD VALUE 'CATALOG';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HotelBookingStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "HotelBookingStatus" ADD VALUE 'REFUND_REQUESTED';
ALTER TYPE "HotelBookingStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "hotel_bookings" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedByStaffId" TEXT,
ADD COLUMN     "hotelId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "isOfflineEntry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "markupAmount" INTEGER,
ADD COLUMN     "offlineReason" TEXT,
ADD COLUMN     "roomTypeId" TEXT,
ADD COLUMN     "supplierCost" INTEGER;

-- CreateTable
CREATE TABLE "hotels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "starRating" INTEGER NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "website" TEXT,
    "checkInTime" TEXT,
    "checkOutTime" TEXT,
    "amenities" TEXT[],
    "images" TEXT[],
    "cancellationPolicy" TEXT,
    "paymentPolicy" TEXT,
    "status" "HotelStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_types" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "capacity" INTEGER NOT NULL,
    "bedType" TEXT,
    "numberOfBeds" INTEGER NOT NULL DEFAULT 1,
    "mealPlan" "MealPlan" NOT NULL DEFAULT 'ROOM_ONLY',
    "supplierCost" INTEGER NOT NULL,
    "sellingPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "totalRooms" INTEGER NOT NULL DEFAULT 1,
    "cancellationRules" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_booking_guests" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT,
    "familyMemberId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_booking_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_refunds" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "requestedByStaffId" TEXT,
    "requestedByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "bookingPrice" INTEGER NOT NULL,
    "supplierPenalty" INTEGER NOT NULL DEFAULT 0,
    "agencyFee" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "HotelRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "hotel_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_packages" (
    "id" TEXT NOT NULL,
    "packageReference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TravelPackageCategory" NOT NULL DEFAULT 'STANDARD',
    "description" TEXT,
    "customerId" TEXT,
    "hajjPackageId" TEXT,
    "umrahPackageId" TEXT,
    "totalCost" INTEGER NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdByStaffId" TEXT,
    "branchId" TEXT,
    "invoiceId" TEXT,
    "isOfflineEntry" BOOLEAN NOT NULL DEFAULT false,
    "offlineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_package_components" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "type" "PackageComponentType" NOT NULL,
    "description" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "flightBookingId" TEXT,
    "hotelBookingId" TEXT,
    "visaApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_package_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotels_city_idx" ON "hotels"("city");

-- CreateIndex
CREATE INDEX "hotels_status_idx" ON "hotels"("status");

-- CreateIndex
CREATE INDEX "hotel_room_types_hotelId_idx" ON "hotel_room_types"("hotelId");

-- CreateIndex
CREATE INDEX "hotel_room_types_isActive_idx" ON "hotel_room_types"("isActive");

-- CreateIndex
CREATE INDEX "hotel_booking_guests_bookingId_idx" ON "hotel_booking_guests"("bookingId");

-- CreateIndex
CREATE INDEX "hotel_refunds_bookingId_idx" ON "hotel_refunds"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "travel_packages_packageReference_key" ON "travel_packages"("packageReference");

-- CreateIndex
CREATE UNIQUE INDEX "travel_packages_invoiceId_key" ON "travel_packages"("invoiceId");

-- CreateIndex
CREATE INDEX "travel_package_components_packageId_idx" ON "travel_package_components"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_bookings_idempotencyKey_key" ON "hotel_bookings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "hotel_bookings_hotelId_idx" ON "hotel_bookings"("hotelId");

-- CreateIndex
CREATE INDEX "hotel_bookings_roomTypeId_idx" ON "hotel_bookings"("roomTypeId");

-- AddForeignKey
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_booking_guests" ADD CONSTRAINT "hotel_booking_guests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hotel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_booking_guests" ADD CONSTRAINT "hotel_booking_guests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_booking_guests" ADD CONSTRAINT "hotel_booking_guests_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_refunds" ADD CONSTRAINT "hotel_refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hotel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_refunds" ADD CONSTRAINT "hotel_refunds_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_package_components" ADD CONSTRAINT "travel_package_components_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "travel_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

