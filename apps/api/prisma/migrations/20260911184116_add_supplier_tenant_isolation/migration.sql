-- Phase 11 spec #2/#65 fix — FlightSupplier/SupplierPayable had no
-- company-derivable field at all, the one gap left after the cross-tenant
-- sweep. Added nullable first, backfilled per-row, then locked to NOT NULL
-- — same safe pattern as customers.companyId earlier this phase.

-- AlterTable
ALTER TABLE "flight_suppliers" ADD COLUMN "companyId" TEXT;
ALTER TABLE "supplier_payables" ADD COLUMN "companyId" TEXT;

-- Backfill flight_suppliers: no company-derivable relation exists on this
-- table at all (it predates multi-tenancy), so every pre-existing supplier
-- is attributed to the platform's original company — the same "oldest
-- company" fallback used for customers.companyId.
UPDATE "flight_suppliers"
SET "companyId" = (SELECT id FROM "companies" ORDER BY "createdAt" ASC LIMIT 1);

-- Backfill supplier_payables accurately, per row, by following its
-- polymorphic sourceModule/sourceId pointer back to the booking that owes
-- the money and reading that booking's customer's companyId. This is more
-- precise than a single fallback because the real ownership is knowable.
UPDATE "supplier_payables" sp
SET "companyId" = c."companyId"
FROM "flight_bookings" fb
JOIN "customers" c ON c.id = fb."customerId"
WHERE sp."sourceModule" = 'FLIGHT_BOOKING' AND sp."sourceId" = fb.id;

UPDATE "supplier_payables" sp
SET "companyId" = c."companyId"
FROM "hotel_bookings" hb
JOIN "customers" c ON c.id = hb."customerId"
WHERE sp."sourceModule" = 'HOTEL_BOOKING' AND sp."sourceId" = hb.id;

UPDATE "supplier_payables" sp
SET "companyId" = c."companyId"
FROM "visa_applications" va
JOIN "customers" c ON c.id = va."customerId"
WHERE sp."sourceModule" = 'VISA_APPLICATION' AND sp."sourceId" = va.id;

-- Any row whose source booking no longer resolves (orphaned/unknown
-- sourceModule) falls back to the oldest company rather than being left
-- NULL — same reasoning as flight_suppliers above.
UPDATE "supplier_payables"
SET "companyId" = (SELECT id FROM "companies" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "companyId" IS NULL;

-- Lock down NOT NULL now that every row has a value.
ALTER TABLE "flight_suppliers" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplier_payables" ALTER COLUMN "companyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "flight_suppliers_companyId_idx" ON "flight_suppliers"("companyId");
CREATE INDEX "supplier_payables_companyId_idx" ON "supplier_payables"("companyId");

-- AddForeignKey
ALTER TABLE "flight_suppliers" ADD CONSTRAINT "flight_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
