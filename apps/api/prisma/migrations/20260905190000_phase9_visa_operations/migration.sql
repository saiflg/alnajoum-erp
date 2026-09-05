-- CreateEnum
CREATE TYPE "VisaProviderName" AS ENUM ('MANUAL', 'MOCK');

-- CreateEnum
CREATE TYPE "ProviderMessageSeverity" AS ENUM ('INFO', 'WARNING', 'ACTION_REQUIRED');

-- CreateEnum
CREATE TYPE "VisaRefundStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'FAILED', 'REJECTED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'TRAVEL_INSURANCE';

-- AlterEnum
ALTER TYPE "IntegrationCategory" ADD VALUE 'VISA';

-- AlterEnum
ALTER TYPE "VisaApplicationStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "visa_applications" ADD COLUMN     "entryValidity" TEXT,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "issueDate" TIMESTAMP(3),
ADD COLUMN     "slaDueAt" TIMESTAMP(3),
ADD COLUMN     "slaTargetDays" INTEGER,
ADD COLUMN     "stayDurationDays" INTEGER;

-- CreateTable
CREATE TABLE "country_visa_rules" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "visaType" TEXT,
    "requiredDocumentTypes" "DocumentType"[],
    "optionalDocumentTypes" "DocumentType"[],
    "minPassportValidityMonths" INTEGER,
    "photoRequirements" TEXT,
    "guarantorRequired" BOOLEAN NOT NULL DEFAULT false,
    "processingTimeDays" INTEGER,
    "appointmentRequired" BOOLEAN NOT NULL DEFAULT false,
    "insuranceRequired" BOOLEAN NOT NULL DEFAULT false,
    "feeAmount" INTEGER,
    "feeCurrency" TEXT,
    "restrictions" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_visa_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_checklist_exceptions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_checklist_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_submissions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "submittedByStaffId" TEXT NOT NULL,
    "provider" "VisaProviderName" NOT NULL,
    "externalReference" TEXT,
    "providerStatus" TEXT,
    "providerMessage" TEXT,
    "documentsSubmitted" JSONB,
    "submissionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_provider_messages" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "ProviderMessageSeverity" NOT NULL DEFAULT 'INFO',
    "acknowledgedByStaffId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_provider_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_refunds" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "requestedByStaffId" TEXT,
    "requestedByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "amountPaid" INTEGER NOT NULL,
    "supplierPenalty" INTEGER NOT NULL DEFAULT 0,
    "agencyFee" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "VisaRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "visa_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "country_visa_rules_country_idx" ON "country_visa_rules"("country");

-- CreateIndex
CREATE UNIQUE INDEX "country_visa_rules_country_visaType_key" ON "country_visa_rules"("country", "visaType");

-- CreateIndex
CREATE INDEX "document_checklist_exceptions_applicationId_idx" ON "document_checklist_exceptions"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "document_checklist_exceptions_applicationId_documentType_key" ON "document_checklist_exceptions"("applicationId", "documentType");

-- CreateIndex
CREATE INDEX "visa_submissions_applicationId_idx" ON "visa_submissions"("applicationId");

-- CreateIndex
CREATE INDEX "visa_provider_messages_applicationId_idx" ON "visa_provider_messages"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "visa_refunds_applicationId_key" ON "visa_refunds"("applicationId");

-- AddForeignKey
ALTER TABLE "document_checklist_exceptions" ADD CONSTRAINT "document_checklist_exceptions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklist_exceptions" ADD CONSTRAINT "document_checklist_exceptions_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_submissions" ADD CONSTRAINT "visa_submissions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_submissions" ADD CONSTRAINT "visa_submissions_submittedByStaffId_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_provider_messages" ADD CONSTRAINT "visa_provider_messages_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_provider_messages" ADD CONSTRAINT "visa_provider_messages_acknowledgedByStaffId_fkey" FOREIGN KEY ("acknowledgedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_refunds" ADD CONSTRAINT "visa_refunds_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_refunds" ADD CONSTRAINT "visa_refunds_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

