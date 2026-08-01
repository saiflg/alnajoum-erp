-- CreateEnum
CREATE TYPE "FlightProviderName" AS ENUM ('MOCK', 'DUFFEL');

-- CreateEnum
CREATE TYPE "FlightBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PassengerType" AS ENUM ('ADULT', 'CHILD', 'INFANT');

-- CreateEnum
CREATE TYPE "CabinClass" AS ENUM ('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST');

-- CreateTable
CREATE TABLE "flight_bookings" (
    "id" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookedByStaffId" TEXT,
    "provider" "FlightProviderName" NOT NULL,
    "providerOfferId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "status" "FlightBookingStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "returnAt" TIMESTAMP(3),
    "cabinClass" "CabinClass" NOT NULL,
    "itinerary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_booking_passengers" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "PassengerType" NOT NULL,
    "customerId" TEXT,
    "familyMemberId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "passportNumber" TEXT,
    "ticketNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_booking_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flight_bookings_bookingReference_key" ON "flight_bookings"("bookingReference");

-- CreateIndex
CREATE INDEX "flight_bookings_customerId_idx" ON "flight_bookings"("customerId");

-- CreateIndex
CREATE INDEX "flight_bookings_status_idx" ON "flight_bookings"("status");

-- CreateIndex
CREATE INDEX "flight_bookings_bookedByStaffId_idx" ON "flight_bookings"("bookedByStaffId");

-- CreateIndex
CREATE INDEX "flight_booking_passengers_bookingId_idx" ON "flight_booking_passengers"("bookingId");

-- CreateIndex
CREATE INDEX "flight_booking_passengers_customerId_idx" ON "flight_booking_passengers"("customerId");

-- CreateIndex
CREATE INDEX "flight_booking_passengers_familyMemberId_idx" ON "flight_booking_passengers"("familyMemberId");

-- AddForeignKey
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_bookedByStaffId_fkey" FOREIGN KEY ("bookedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_booking_passengers" ADD CONSTRAINT "flight_booking_passengers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "flight_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_booking_passengers" ADD CONSTRAINT "flight_booking_passengers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_booking_passengers" ADD CONSTRAINT "flight_booking_passengers_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
