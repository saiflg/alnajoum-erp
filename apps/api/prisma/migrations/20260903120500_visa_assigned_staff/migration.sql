-- AlterTable
ALTER TABLE "staff_incentives" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "visa_applications" ADD COLUMN     "assignedStaffId" TEXT;

-- CreateIndex
CREATE INDEX "visa_applications_assignedStaffId_idx" ON "visa_applications"("assignedStaffId");

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
