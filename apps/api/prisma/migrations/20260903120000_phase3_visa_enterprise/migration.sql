-- CreateEnum
CREATE TYPE "IncentiveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "IncentivePolicyType" AS ENUM ('FULL_MARGIN', 'PERCENT_OF_MARGIN', 'FIXED_AMOUNT', 'STAFF_COMPANY_SPLIT', 'STAFF_BRANCH_COMPANY_SPLIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED');

-- CreateEnum
CREATE TYPE "VisaServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VisaDocumentStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'BANK_STATEMENT';
ALTER TYPE "DocumentType" ADD VALUE 'INVITATION_LETTER';
ALTER TYPE "DocumentType" ADD VALUE 'HOTEL_BOOKING';
ALTER TYPE "DocumentType" ADD VALUE 'FLIGHT_ITINERARY';
ALTER TYPE "DocumentType" ADD VALUE 'GUARANTOR_ID';
ALTER TYPE "DocumentType" ADD VALUE 'GUARANTOR_DOCUMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VisaApplicationStatus" ADD VALUE 'DRAFT';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'AWAITING_DOCUMENTS';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'AWAITING_GUARANTOR';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'GUARANTOR_VERIFICATION';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'PAYMENT_PENDING';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'PAYMENT_VERIFIED';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'SUBMITTED_TO_PROVIDER';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'ADDITIONAL_INFO_REQUIRED';
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "staff_incentives" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByStaffId" TEXT,
ADD COLUMN     "companyCost" INTEGER,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "margin" INTEGER,
ADD COLUMN     "policyId" TEXT,
ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "sellingPrice" INTEGER,
ADD COLUMN     "status" "IncentiveStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Data fix: existing Hajj/Umrah incentive rows predate the PENDING/APPROVED/
-- PAID workflow and were already-settled "informational only" history (see
-- StaffIncentive's updated doc comment) — backfill them to PAID so they
-- don't suddenly appear as awaiting approval on the new incentives screen.
-- Rows created from this point on (including any inserted by this same
-- deploy's seed step) correctly default to PENDING via the column default
-- above.
UPDATE "staff_incentives" SET "status" = 'PAID' WHERE "status" = 'PENDING';

-- AlterTable
ALTER TABLE "visa_applications" ADD COLUMN     "companyCostSnapshot" INTEGER,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "guarantorId" TEXT,
ADD COLUMN     "guarantorRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOfflineEntry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offlineReason" TEXT,
ADD COLUMN     "previousVisaInfo" TEXT,
ADD COLUMN     "sellingPriceSnapshot" INTEGER,
ADD COLUMN     "visaServiceId" TEXT;

-- CreateTable
CREATE TABLE "incentive_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IncentivePolicyType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_payouts" (
    "id" TEXT NOT NULL,
    "incentiveId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "providerError" TEXT,
    "requestedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_services" (
    "id" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "visaType" TEXT NOT NULL,
    "visaCategory" TEXT,
    "description" TEXT,
    "processingTime" TEXT,
    "validityPeriod" TEXT,
    "entryType" TEXT,
    "requiredDocuments" TEXT,
    "supplierName" TEXT,
    "supplierCost" INTEGER,
    "companyCost" INTEGER NOT NULL,
    "sellingPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "processingFee" INTEGER NOT NULL DEFAULT 0,
    "otherFees" INTEGER NOT NULL DEFAULT 0,
    "incentivePolicyId" TEXT,
    "termsAndConditions" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "status" "VisaServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guarantors" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "relationship" TEXT NOT NULL,
    "idType" TEXT,
    "idNumber" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "acceptedResponsibilityAt" TIMESTAMP(3),
    "verifiedByStaffId" TEXT,
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guarantors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_documents" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "guarantorId" TEXT,
    "type" "DocumentType" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByIdentityId" TEXT,
    "expiryDate" TIMESTAMP(3),
    "status" "VisaDocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedByStaffId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_application_notes" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_application_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_payouts_incentiveId_key" ON "staff_payouts"("incentiveId");

-- CreateIndex
CREATE INDEX "staff_payouts_staffId_idx" ON "staff_payouts"("staffId");

-- CreateIndex
CREATE INDEX "staff_payouts_status_idx" ON "staff_payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "visa_services_serviceCode_key" ON "visa_services"("serviceCode");

-- CreateIndex
CREATE INDEX "visa_services_status_idx" ON "visa_services"("status");

-- CreateIndex
CREATE INDEX "visa_services_country_idx" ON "visa_services"("country");

-- CreateIndex
CREATE UNIQUE INDEX "visa_documents_storedFileName_key" ON "visa_documents"("storedFileName");

-- CreateIndex
CREATE INDEX "visa_documents_applicationId_idx" ON "visa_documents"("applicationId");

-- CreateIndex
CREATE INDEX "visa_documents_guarantorId_idx" ON "visa_documents"("guarantorId");

-- CreateIndex
CREATE INDEX "visa_documents_status_idx" ON "visa_documents"("status");

-- CreateIndex
CREATE INDEX "visa_application_notes_applicationId_idx" ON "visa_application_notes"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_incentives_referenceNumber_key" ON "staff_incentives"("referenceNumber");

-- CreateIndex
CREATE INDEX "staff_incentives_status_idx" ON "staff_incentives"("status");

-- CreateIndex
CREATE UNIQUE INDEX "visa_applications_guarantorId_key" ON "visa_applications"("guarantorId");

-- CreateIndex
CREATE INDEX "visa_applications_visaServiceId_idx" ON "visa_applications"("visaServiceId");

-- AddForeignKey
ALTER TABLE "staff_incentives" ADD CONSTRAINT "staff_incentives_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "incentive_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_incentives" ADD CONSTRAINT "staff_incentives_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_incentives" ADD CONSTRAINT "staff_incentives_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_payouts" ADD CONSTRAINT "staff_payouts_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "staff_incentives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_payouts" ADD CONSTRAINT "staff_payouts_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_payouts" ADD CONSTRAINT "staff_payouts_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_services" ADD CONSTRAINT "visa_services_incentivePolicyId_fkey" FOREIGN KEY ("incentivePolicyId") REFERENCES "incentive_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_verifiedByStaffId_fkey" FOREIGN KEY ("verifiedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_documents" ADD CONSTRAINT "visa_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_documents" ADD CONSTRAINT "visa_documents_guarantorId_fkey" FOREIGN KEY ("guarantorId") REFERENCES "guarantors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_documents" ADD CONSTRAINT "visa_documents_reviewedByStaffId_fkey" FOREIGN KEY ("reviewedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_application_notes" ADD CONSTRAINT "visa_application_notes_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_application_notes" ADD CONSTRAINT "visa_application_notes_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_visaServiceId_fkey" FOREIGN KEY ("visaServiceId") REFERENCES "visa_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_guarantorId_fkey" FOREIGN KEY ("guarantorId") REFERENCES "guarantors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

