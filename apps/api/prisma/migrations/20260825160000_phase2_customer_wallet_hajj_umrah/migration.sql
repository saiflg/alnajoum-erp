-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE', 'VIP', 'GROUP');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('DEPOSIT', 'PAYMENT', 'REFUND', 'ADJUSTMENT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'REVERSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'FULLY_BOOKED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "UmrahPackageType" AS ENUM ('GROUP', 'FAMILY', 'VIP', 'ECONOMY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ManualPaymentStatus" AS ENUM ('PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'CLARIFICATION_REQUESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'WALLET_DEPOSIT';
ALTER TYPE "NotificationType" ADD VALUE 'WALLET_DEBIT';
ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'HAJJ_UMRAH_DEADLINE';
ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_MISSING';
ALTER TYPE "NotificationType" ADD VALUE 'MANUAL_PAYMENT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'MANUAL_PAYMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'MANUAL_PAYMENT_REJECTED';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'WALLET';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "assignedBranchId" TEXT,
ADD COLUMN     "assignedStaffId" TEXT,
ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "hajjRegistrationId" TEXT,
ADD COLUMN     "umrahRegistrationId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "identityId" TEXT,
ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "internalCost" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "durationDays" INTEGER,
    "departureDate" TIMESTAMP(3),
    "returnDate" TIMESTAMP(3),
    "airline" TEXT,
    "hotel" TEXT,
    "accommodation" TEXT,
    "transport" TEXT,
    "meals" TEXT,
    "visaIncluded" BOOLEAN NOT NULL DEFAULT true,
    "ziyaratIncluded" BOOLEAN NOT NULL DEFAULT true,
    "guideIncluded" BOOLEAN NOT NULL DEFAULT true,
    "maxPilgrims" INTEGER NOT NULL,
    "seatsAvailable" INTEGER NOT NULL,
    "paymentPlan" TEXT,
    "termsAndConditions" TEXT,
    "requiredDocuments" TEXT,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_registrations" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "registeredByStaffId" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_registration_pilgrims" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "customerId" TEXT,
    "familyMemberId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "passportNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hajj_registration_pilgrims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "umrah_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "packageType" "UmrahPackageType" NOT NULL DEFAULT 'GROUP',
    "costPrice" INTEGER NOT NULL,
    "sellingPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "incentiveRule" JSONB,
    "hotel" TEXT,
    "flight" TEXT,
    "transport" TEXT,
    "visaIncluded" BOOLEAN NOT NULL DEFAULT true,
    "durationDays" INTEGER,
    "departureDate" TIMESTAMP(3),
    "returnDate" TIMESTAMP(3),
    "maxPilgrims" INTEGER NOT NULL,
    "seatsAvailable" INTEGER NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "umrah_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "umrah_registrations" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "registeredByStaffId" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "umrah_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "umrah_registration_pilgrims" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "customerId" TEXT,
    "familyMemberId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "passportNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "umrah_registration_pilgrims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_payment_submissions" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bankName" TEXT,
    "transactionReference" TEXT,
    "description" TEXT,
    "receiptDocumentPath" TEXT,
    "status" "ManualPaymentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "submittedByStaffId" TEXT,
    "reviewedByStaffId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_payment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_incentives" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_incentives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_customerId_key" ON "wallets"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_reference_key" ON "wallet_transactions"("reference");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_idx" ON "wallet_transactions"("walletId");

-- CreateIndex
CREATE INDEX "wallet_transactions_status_idx" ON "wallet_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hajj_registrations_registrationNumber_key" ON "hajj_registrations"("registrationNumber");

-- CreateIndex
CREATE INDEX "hajj_registrations_packageId_idx" ON "hajj_registrations"("packageId");

-- CreateIndex
CREATE INDEX "hajj_registrations_customerId_idx" ON "hajj_registrations"("customerId");

-- CreateIndex
CREATE INDEX "hajj_registration_pilgrims_registrationId_idx" ON "hajj_registration_pilgrims"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "umrah_registrations_registrationNumber_key" ON "umrah_registrations"("registrationNumber");

-- CreateIndex
CREATE INDEX "umrah_registrations_packageId_idx" ON "umrah_registrations"("packageId");

-- CreateIndex
CREATE INDEX "umrah_registrations_customerId_idx" ON "umrah_registrations"("customerId");

-- CreateIndex
CREATE INDEX "umrah_registration_pilgrims_registrationId_idx" ON "umrah_registration_pilgrims"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "manual_payment_submissions_paymentId_key" ON "manual_payment_submissions"("paymentId");

-- CreateIndex
CREATE INDEX "manual_payment_submissions_invoiceId_idx" ON "manual_payment_submissions"("invoiceId");

-- CreateIndex
CREATE INDEX "manual_payment_submissions_customerId_idx" ON "manual_payment_submissions"("customerId");

-- CreateIndex
CREATE INDEX "manual_payment_submissions_status_idx" ON "manual_payment_submissions"("status");

-- CreateIndex
CREATE INDEX "staff_incentives_staffId_idx" ON "staff_incentives"("staffId");

-- CreateIndex
CREATE INDEX "staff_incentives_sourceType_sourceId_idx" ON "staff_incentives"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "customers_assignedStaffId_idx" ON "customers"("assignedStaffId");

-- CreateIndex
CREATE INDEX "customers_assignedBranchId_idx" ON "customers"("assignedBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_hajjRegistrationId_key" ON "invoices"("hajjRegistrationId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_umrahRegistrationId_key" ON "invoices"("umrahRegistrationId");

-- CreateIndex
CREATE INDEX "notifications_identityId_idx" ON "notifications"("identityId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_assignedBranchId_fkey" FOREIGN KEY ("assignedBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hajjRegistrationId_fkey" FOREIGN KEY ("hajjRegistrationId") REFERENCES "hajj_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_umrahRegistrationId_fkey" FOREIGN KEY ("umrahRegistrationId") REFERENCES "umrah_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_registrations" ADD CONSTRAINT "hajj_registrations_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "hajj_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_registrations" ADD CONSTRAINT "hajj_registrations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_registrations" ADD CONSTRAINT "hajj_registrations_registeredByStaffId_fkey" FOREIGN KEY ("registeredByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_registration_pilgrims" ADD CONSTRAINT "hajj_registration_pilgrims_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "hajj_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_registration_pilgrims" ADD CONSTRAINT "hajj_registration_pilgrims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_registration_pilgrims" ADD CONSTRAINT "hajj_registration_pilgrims_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registrations" ADD CONSTRAINT "umrah_registrations_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "umrah_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registrations" ADD CONSTRAINT "umrah_registrations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registrations" ADD CONSTRAINT "umrah_registrations_registeredByStaffId_fkey" FOREIGN KEY ("registeredByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registration_pilgrims" ADD CONSTRAINT "umrah_registration_pilgrims_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "umrah_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registration_pilgrims" ADD CONSTRAINT "umrah_registration_pilgrims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registration_pilgrims" ADD CONSTRAINT "umrah_registration_pilgrims_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_payment_submissions" ADD CONSTRAINT "manual_payment_submissions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_payment_submissions" ADD CONSTRAINT "manual_payment_submissions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_payment_submissions" ADD CONSTRAINT "manual_payment_submissions_submittedByStaffId_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_payment_submissions" ADD CONSTRAINT "manual_payment_submissions_reviewedByStaffId_fkey" FOREIGN KEY ("reviewedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_payment_submissions" ADD CONSTRAINT "manual_payment_submissions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_incentives" ADD CONSTRAINT "staff_incentives_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

