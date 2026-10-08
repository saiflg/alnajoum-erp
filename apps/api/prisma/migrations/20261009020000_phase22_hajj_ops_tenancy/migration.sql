-- Phase 22 (S-12): Hajj/Umrah operations records had no owner, so every company could read and change
-- every other company's groups, rooms, transport and fleet. Each root record now belongs to a company.

ALTER TABLE "hajj_groups"        ADD COLUMN "companyId" TEXT;
ALTER TABLE "umrah_groups"       ADD COLUMN "companyId" TEXT;
ALTER TABLE "hajj_ops_vehicles"  ADD COLUMN "companyId" TEXT;
ALTER TABLE "hajj_ops_drivers"   ADD COLUMN "companyId" TEXT;
ALTER TABLE "hajj_ops_transports" ADD COLUMN "companyId" TEXT;
ALTER TABLE "room_allocations"   ADD COLUMN "companyId" TEXT;

-- Backfill. A group belongs to its coordinator's company when it has one, otherwise to the oldest
-- active company (the platform's original tenant - the same default used for public sign-ups).
UPDATE "hajj_groups" g SET "companyId" = s."companyId" FROM "staff" s WHERE g."coordinatorStaffId" = s."id";
UPDATE "umrah_groups" g SET "companyId" = s."companyId" FROM "staff" s WHERE g."coordinatorStaffId" = s."id";
UPDATE "hajj_groups"  SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "umrah_groups" SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1) WHERE "companyId" IS NULL;

-- Children follow their group; free-standing fleet records take the default company.
UPDATE "hajj_ops_transports" t SET "companyId" = g."companyId" FROM "hajj_groups" g WHERE t."hajjGroupId" = g."id";
UPDATE "hajj_ops_transports" t SET "companyId" = g."companyId" FROM "umrah_groups" g WHERE t."umrahGroupId" = g."id" AND t."companyId" IS NULL;
UPDATE "room_allocations" r SET "companyId" = g."companyId" FROM "hajj_groups" g WHERE r."hajjGroupId" = g."id";
UPDATE "room_allocations" r SET "companyId" = g."companyId" FROM "umrah_groups" g WHERE r."umrahGroupId" = g."id" AND r."companyId" IS NULL;
UPDATE "hajj_ops_transports" SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "room_allocations"    SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "hajj_ops_vehicles"   SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "hajj_ops_drivers" d  SET "companyId" = v."companyId" FROM "hajj_ops_vehicles" v WHERE d."vehicleId" = v."id";
UPDATE "hajj_ops_drivers"    SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1) WHERE "companyId" IS NULL;

CREATE INDEX "hajj_groups_companyId_idx"         ON "hajj_groups"("companyId");
CREATE INDEX "umrah_groups_companyId_idx"        ON "umrah_groups"("companyId");
CREATE INDEX "hajj_ops_vehicles_companyId_idx"   ON "hajj_ops_vehicles"("companyId");
CREATE INDEX "hajj_ops_drivers_companyId_idx"    ON "hajj_ops_drivers"("companyId");
CREATE INDEX "hajj_ops_transports_companyId_idx" ON "hajj_ops_transports"("companyId");
CREATE INDEX "room_allocations_companyId_idx"    ON "room_allocations"("companyId");

ALTER TABLE "hajj_groups"         ADD CONSTRAINT "hajj_groups_companyId_fkey"         FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "umrah_groups"        ADD CONSTRAINT "umrah_groups_companyId_fkey"        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hajj_ops_vehicles"   ADD CONSTRAINT "hajj_ops_vehicles_companyId_fkey"   FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hajj_ops_drivers"    ADD CONSTRAINT "hajj_ops_drivers_companyId_fkey"    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hajj_ops_transports" ADD CONSTRAINT "hajj_ops_transports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_allocations"    ADD CONSTRAINT "room_allocations_companyId_fkey"    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
