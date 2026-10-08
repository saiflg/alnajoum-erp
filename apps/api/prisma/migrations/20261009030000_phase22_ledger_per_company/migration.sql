-- Phase 22 (S-11): the general ledger had no owner. Every company's finance users could read the chart's
-- balances, entries and investments of every other company, and reverse their entries. Journal entries
-- and company investments now belong to a company. The chart of accounts stays a shared template
-- (account codes and types are the same for everyone); balances are computed from a company's own entries.

ALTER TABLE "journal_entries"     ADD COLUMN "companyId" TEXT;
ALTER TABLE "company_investments" ADD COLUMN "companyId" TEXT;

-- ---- Backfill company_investments: the company of whoever recorded it, else the oldest active company.
UPDATE "company_investments" ci SET "companyId" = s."companyId"
  FROM "staff" s WHERE ci."recordedByIdentityId" = s."identityId";
UPDATE "company_investments"
  SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "companyId" IS NULL;

-- ---- Backfill journal_entries from the record each entry was posted for (sourceModule / sourceId).
-- bookings and applications -> their customer's company
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "flight_bookings" b JOIN "customers" c ON c."id" = b."customerId"
  WHERE j."sourceModule" = 'FLIGHT_BOOKING' AND j."sourceId" = b."id";
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "hotel_bookings" b JOIN "customers" c ON c."id" = b."customerId"
  WHERE j."sourceModule" = 'HOTEL_BOOKING' AND j."sourceId" = b."id";
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "visa_applications" b JOIN "customers" c ON c."id" = b."customerId"
  WHERE j."sourceModule" = 'VISA_APPLICATION' AND j."sourceId" = b."id";
-- refunds and voids -> their booking's customer's company
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "flight_refunds" r JOIN "flight_bookings" b ON b."id" = r."bookingId" JOIN "customers" c ON c."id" = b."customerId"
  WHERE j."sourceModule" = 'FLIGHT_REFUND' AND j."sourceId" = r."id";
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "flight_voids" r JOIN "flight_bookings" b ON b."id" = r."bookingId" JOIN "customers" c ON c."id" = b."customerId"
  WHERE j."sourceModule" = 'FLIGHT_VOID' AND j."sourceId" = r."id";
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "hotel_refunds" r JOIN "hotel_bookings" b ON b."id" = r."bookingId" JOIN "customers" c ON c."id" = b."customerId"
  WHERE j."sourceModule" = 'HOTEL_REFUND' AND j."sourceId" = r."id";
UPDATE "journal_entries" j SET "companyId" = c."companyId" FROM "visa_refunds" r JOIN "visa_applications" a ON a."id" = r."applicationId" JOIN "customers" c ON c."id" = a."customerId"
  WHERE j."sourceModule" = 'VISA_REFUND' AND j."sourceId" = r."id";
-- payments -> invoice -> customer, else the issuing staff member's company, else the corporate booking's staff
UPDATE "journal_entries" j SET "companyId" = COALESCE(c."companyId", s."companyId", bs."companyId")
  FROM "payments" p JOIN "invoices" i ON i."id" = p."invoiceId"
  LEFT JOIN "customers" c ON c."id" = i."customerId"
  LEFT JOIN "staff" s ON s."id" = i."issuedByStaffId"
  LEFT JOIN "corporate_bookings" cb ON cb."id" = i."corporateBookingId"
  LEFT JOIN "staff" bs ON bs."id" = cb."bookedByStaffId"
  WHERE j."sourceModule" = 'PAYMENT' AND j."sourceId" = p."id";
-- wallet movements -> wallet -> customer
UPDATE "journal_entries" j SET "companyId" = c."companyId"
  FROM "wallet_transactions" t JOIN "wallets" w ON w."id" = t."walletId" JOIN "customers" c ON c."id" = w."customerId"
  WHERE j."sourceModule" = 'WALLET' AND j."sourceId" = t."id";
-- staff-originated records -> the staff member's company
UPDATE "journal_entries" j SET "companyId" = s."companyId" FROM "expenses" e JOIN "staff" s ON s."id" = e."createdByStaffId"
  WHERE j."sourceModule" = 'EXPENSE' AND j."sourceId" = e."id";
UPDATE "journal_entries" j SET "companyId" = s."companyId" FROM "staff_incentives" e JOIN "staff" s ON s."id" = e."staffId"
  WHERE j."sourceModule" = 'INCENTIVE' AND j."sourceId" = e."id";
UPDATE "journal_entries" j SET "companyId" = s."companyId" FROM "staff_payouts" e JOIN "staff" s ON s."id" = e."staffId"
  WHERE j."sourceModule" = 'PAYOUT' AND j."sourceId" = e."id";
UPDATE "journal_entries" j SET "companyId" = pb."companyId" FROM "supplier_payments" sp JOIN "supplier_payables" pb ON pb."id" = sp."payableId"
  WHERE j."sourceModule" = 'SUPPLIER_PAYMENT' AND j."sourceId" = sp."id";
UPDATE "journal_entries" j SET "companyId" = e."companyId" FROM "company_investments" e
  WHERE j."sourceModule" = 'INVESTMENT' AND j."sourceId" = e."id";
-- a reversal belongs to the entry it reverses
UPDATE "journal_entries" r SET "companyId" = o."companyId" FROM "journal_entries" o
  WHERE r."reversalOfId" = o."id" AND r."companyId" IS NULL;
-- anything that still has no owner (a branch-attributed or unrecognised entry) -> the branch's company, else the default
UPDATE "journal_entries" j SET "companyId" = b."companyId" FROM "branches" b WHERE j."companyId" IS NULL AND j."branchId" = b."id";
UPDATE "journal_entries"
  SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "companyId" IS NULL;

CREATE INDEX "journal_entries_companyId_createdAt_idx" ON "journal_entries"("companyId", "createdAt");
CREATE INDEX "company_investments_companyId_idx"       ON "company_investments"("companyId");

ALTER TABLE "journal_entries"     ADD CONSTRAINT "journal_entries_companyId_fkey"     FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_investments" ADD CONSTRAINT "company_investments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Daily closing: one per company per business date (it was one per date for the whole platform, so a
-- second company could never close a day the first had closed).
ALTER TABLE "daily_closings" ADD COLUMN "companyId" TEXT;
UPDATE "daily_closings" d SET "companyId" = s."companyId" FROM "staff" s WHERE d."closedByStaffId" = s."id";
UPDATE "daily_closings"
  SET "companyId" = (SELECT "id" FROM "companies" WHERE "isActive" ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "companyId" IS NULL;
ALTER TABLE "daily_closings" ALTER COLUMN "companyId" SET NOT NULL;
DROP INDEX IF EXISTS "daily_closings_businessDate_key";
CREATE UNIQUE INDEX "daily_closings_companyId_businessDate_key" ON "daily_closings"("companyId", "businessDate");
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
