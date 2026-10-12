-- Phase 24: passport numbers are encrypted at rest. This keyed fingerprint lets staff still find a customer by an
-- exact passport number (dashboard search) without storing the number in the clear. See field-cipher.ts blindIndex.
ALTER TABLE "customers" ADD COLUMN "passportNumberIndex" TEXT;
CREATE INDEX "customers_passportNumberIndex_idx" ON "customers"("passportNumberIndex");