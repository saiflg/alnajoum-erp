-- AlterEnum
ALTER TYPE "IntegrationCategory" ADD VALUE 'HOTEL';

-- AlterTable
ALTER TABLE "hotel_bookings" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "hotel_bookings_idempotencyKey_key" ON "hotel_bookings"("idempotencyKey");

