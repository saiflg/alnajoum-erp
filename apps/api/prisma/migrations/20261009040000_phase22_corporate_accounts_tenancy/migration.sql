-- Phase 22 (S-12): corporate clients had no owner; every company could list, edit and book against every
-- other company's corporate accounts. They now belong to a company (backfilled from the managing branch,
-- else the oldest active company).
ALTER TABLE "corporate_accounts" ADD COLUMN "companyId" TEXT;
UPDATE "corporate_accounts" a SET "companyId" = b."companyId" FROM "branches" b WHERE a."managedBranchId" = b."id";
UPDATE "corporate_accounts"
  SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "companyId" IS NULL;
CREATE INDEX "corporate_accounts_companyId_idx" ON "corporate_accounts"("companyId");
ALTER TABLE "corporate_accounts" ADD CONSTRAINT "corporate_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
