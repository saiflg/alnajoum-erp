-- AlterTable
ALTER TABLE "visa_applications" ADD COLUMN     "guarantorExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guarantorExemptReason" TEXT;

-- AlterTable
ALTER TABLE "visa_services" ADD COLUMN     "requiresGuarantor" BOOLEAN NOT NULL DEFAULT true;

