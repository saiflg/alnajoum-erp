-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'GUARANTOR_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'GUARANTOR_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'GUARANTOR_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'VISA_DOCUMENT_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'VISA_DOCUMENT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'INCENTIVE_GENERATED';
ALTER TYPE "NotificationType" ADD VALUE 'INCENTIVE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'INCENTIVE_PAID';

