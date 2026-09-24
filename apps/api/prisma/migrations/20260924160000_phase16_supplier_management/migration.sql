-- Phase 16 — domain-agnostic Supplier management foundation. FlightSupplier/
-- FlightSupplierContract are untouched; this adds the equivalent master
-- record for Hotel/Visa/Hajj/Umrah/Transport suppliers, which have never
-- had one (SupplierPayable.supplierName has been free-text-only for those
-- domains since Phase 11). Additive only: one new nullable column on the
-- existing supplier_payables table, everything else is new tables.

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('AIRLINE', 'GDS', 'FLIGHT_CONSOLIDATOR', 'HOTEL', 'HOTEL_WHOLESALER', 'VISA_PROVIDER', 'HAJJ_SUPPLIER', 'UMRAH_SUPPLIER', 'TRANSPORT_COMPANY', 'BUS_OPERATOR', 'CAR_RENTAL', 'ACTIVITY_PROVIDER', 'TOUR_OPERATOR', 'INSURANCE_PROVIDER', 'TICKET_CONSOLIDATOR', 'GROUND_HANDLER', 'LOCAL_PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierOnboardingStatus" AS ENUM ('DRAFT', 'INVITED', 'INFORMATION_SUBMITTED', 'KYC_REVIEW', 'DOCUMENT_REVIEW', 'COMMERCIAL_REVIEW', 'FINANCE_REVIEW', 'ADMIN_APPROVAL', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SupplierKycStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierRiskStatus" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SupplierContractStatus" AS ENUM ('DRAFT', 'NEGOTIATION', 'PENDING_APPROVAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "type" "SupplierType" NOT NULL,
    "registrationNumber" TEXT,
    "country" TEXT,
    "address" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "settlementCurrency" TEXT,
    "paymentTerms" TEXT,
    "settlementCycle" TEXT,
    "creditLimit" INTEGER,
    "depositRequired" INTEGER,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "taxIdentificationNumber" TEXT,
    "onboardingStatus" "SupplierOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "kycStatus" "SupplierKycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "riskStatus" "SupplierRiskStatus" NOT NULL DEFAULT 'LOW',
    "accountManagerStaffId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contacts" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_documents" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "uploadedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contracts" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "paymentTerms" TEXT,
    "creditTerms" TEXT,
    "commissionPercent" DOUBLE PRECISION,
    "rebatePercent" DOUBLE PRECISION,
    "markupPercent" DOUBLE PRECISION,
    "settlementCycle" TEXT,
    "cancellationConditions" TEXT,
    "amendmentConditions" TEXT,
    "documentUrl" TEXT,
    "status" "SupplierContractStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_contracts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "supplier_payables" ADD COLUMN "supplierId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "supplier_contracts_contractNumber_key" ON "supplier_contracts"("contractNumber");

CREATE INDEX "suppliers_companyId_idx" ON "suppliers"("companyId");
CREATE INDEX "suppliers_type_idx" ON "suppliers"("type");
CREATE INDEX "suppliers_onboardingStatus_idx" ON "suppliers"("onboardingStatus");

CREATE INDEX "supplier_contacts_supplierId_idx" ON "supplier_contacts"("supplierId");

CREATE INDEX "supplier_documents_supplierId_idx" ON "supplier_documents"("supplierId");

CREATE INDEX "supplier_contracts_supplierId_idx" ON "supplier_contracts"("supplierId");
CREATE INDEX "supplier_contracts_status_idx" ON "supplier_contracts"("status");

CREATE INDEX "supplier_payables_supplierId_idx" ON "supplier_payables"("supplierId");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_accountManagerStaffId_fkey" FOREIGN KEY ("accountManagerStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_contracts" ADD CONSTRAINT "supplier_contracts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
