-- AlterTable
ALTER TABLE "room_allocations" ADD COLUMN     "hotelBookingId" TEXT;

-- AddForeignKey
ALTER TABLE "room_allocations" ADD CONSTRAINT "room_allocations_hotelBookingId_fkey" FOREIGN KEY ("hotelBookingId") REFERENCES "hotel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

