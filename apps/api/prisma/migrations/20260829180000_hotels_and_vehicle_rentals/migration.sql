-- CreateEnum
CREATE TYPE "HotelProviderName" AS ENUM ('MOCK');
-- CreateEnum
CREATE TYPE "HotelBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'VAN', 'BUS');
-- CreateEnum
CREATE TYPE "VehicleRentalProviderName" AS ENUM ('MOCK');
-- CreateEnum
CREATE TYPE "VehicleRentalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "hotelBookingId" TEXT,
ADD COLUMN     "vehicleRentalId" TEXT;
-- CreateTable
CREATE TABLE "hotel_bookings" (
    "id" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookedByStaffId" TEXT,
    "provider" "HotelProviderName" NOT NULL,
    "providerOfferId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "status" "HotelBookingStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "hotelName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "starRating" INTEGER NOT NULL,
    "roomType" TEXT NOT NULL,
    "checkInDate" TIMESTAMP(3) NOT NULL,
    "checkOutDate" TIMESTAMP(3) NOT NULL,
    "rooms" INTEGER NOT NULL,
    "guests" INTEGER NOT NULL,
    "offerSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hotel_bookings_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "vehicle_rentals" (
    "id" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookedByStaffId" TEXT,
    "provider" "VehicleRentalProviderName" NOT NULL,
    "providerOfferId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "status" "VehicleRentalStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleName" TEXT NOT NULL,
    "pickupCity" TEXT NOT NULL,
    "pickupLocation" TEXT NOT NULL,
    "dropoffLocation" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "dropoffAt" TIMESTAMP(3) NOT NULL,
    "withDriver" BOOLEAN NOT NULL DEFAULT true,
    "offerSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vehicle_rentals_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "hotel_bookings_bookingReference_key" ON "hotel_bookings"("bookingReference");
-- CreateIndex
CREATE INDEX "hotel_bookings_customerId_idx" ON "hotel_bookings"("customerId");
-- CreateIndex
CREATE INDEX "hotel_bookings_bookedByStaffId_idx" ON "hotel_bookings"("bookedByStaffId");
-- CreateIndex
CREATE UNIQUE INDEX "vehicle_rentals_bookingReference_key" ON "vehicle_rentals"("bookingReference");
-- CreateIndex
CREATE INDEX "vehicle_rentals_customerId_idx" ON "vehicle_rentals"("customerId");
-- CreateIndex
CREATE INDEX "vehicle_rentals_bookedByStaffId_idx" ON "vehicle_rentals"("bookedByStaffId");
-- CreateIndex
CREATE UNIQUE INDEX "invoices_hotelBookingId_key" ON "invoices"("hotelBookingId");
-- CreateIndex
CREATE UNIQUE INDEX "invoices_vehicleRentalId_key" ON "invoices"("vehicleRentalId");
-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hotelBookingId_fkey" FOREIGN KEY ("hotelBookingId") REFERENCES "hotel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicleRentalId_fkey" FOREIGN KEY ("vehicleRentalId") REFERENCES "vehicle_rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_bookedByStaffId_fkey" FOREIGN KEY ("bookedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "vehicle_rentals" ADD CONSTRAINT "vehicle_rentals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "vehicle_rentals" ADD CONSTRAINT "vehicle_rentals_bookedByStaffId_fkey" FOREIGN KEY ("bookedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
