-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY');

-- AlterTable: add tripType, backfilling from the now-removed returnAt column
ALTER TABLE "flight_bookings" ADD COLUMN "tripType" "TripType";

UPDATE "flight_bookings"
SET "tripType" = CASE WHEN "returnAt" IS NOT NULL THEN 'ROUND_TRIP' ELSE 'ONE_WAY' END::"TripType";

ALTER TABLE "flight_bookings" ALTER COLUMN "tripType" SET NOT NULL;

ALTER TABLE "flight_bookings" DROP COLUMN "returnAt";
