-- Campaign.createdByStaffId becomes a real relation so campaigns can be tenant-scoped through their creator (Phase 22).
CREATE INDEX "campaigns_createdByStaffId_idx" ON "campaigns"("createdByStaffId");
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
