-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('INITIAL', 'ADDITIONAL', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "SupplierPayableStatus" AS ENUM ('OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "DailyClosingStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- AlterEnum
ALTER TYPE "IncentiveStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "bankAccountVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankAccountVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "bankAccountVerifiedByStaffId" TEXT;

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "reversalOfId" TEXT,
    "createdByIdentityId" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expenseNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "paymentMethod" "PaymentMethod",
    "receiptDocumentPath" TEXT,
    "branchId" TEXT,
    "accountId" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDING',
    "createdByStaffId" TEXT NOT NULL,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_investments" (
    "id" TEXT NOT NULL,
    "type" "InvestmentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "investor" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "recordedByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payables" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "status" "SupplierPayableStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedByStaffId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closings" (
    "id" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,
    "summary" JSONB NOT NULL,
    "closedByStaffId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DailyClosingStatus" NOT NULL DEFAULT 'CLOSED',

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "externalReference" TEXT,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedType" TEXT,
    "matchedId" TEXT,
    "importedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_idx" ON "ledger_accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_debitAccountId_idx" ON "journal_entries"("debitAccountId");

-- CreateIndex
CREATE INDEX "journal_entries_creditAccountId_idx" ON "journal_entries"("creditAccountId");

-- CreateIndex
CREATE INDEX "journal_entries_sourceModule_sourceId_idx" ON "journal_entries"("sourceModule", "sourceId");

-- CreateIndex
CREATE INDEX "journal_entries_reference_idx" ON "journal_entries"("reference");

-- CreateIndex
CREATE INDEX "journal_entries_status_idx" ON "journal_entries"("status");

-- CreateIndex
CREATE INDEX "journal_entries_createdAt_idx" ON "journal_entries"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expenseNumber_key" ON "expenses"("expenseNumber");

-- CreateIndex
CREATE INDEX "expenses_status_idx" ON "expenses"("status");

-- CreateIndex
CREATE INDEX "expenses_branchId_idx" ON "expenses"("branchId");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "company_investments_type_idx" ON "company_investments"("type");

-- CreateIndex
CREATE INDEX "supplier_payables_status_idx" ON "supplier_payables"("status");

-- CreateIndex
CREATE INDEX "supplier_payables_sourceModule_sourceId_idx" ON "supplier_payables"("sourceModule", "sourceId");

-- CreateIndex
CREATE INDEX "supplier_payments_payableId_idx" ON "supplier_payments"("payableId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_businessDate_key" ON "daily_closings"("businessDate");

-- CreateIndex
CREATE INDEX "daily_closings_businessDate_idx" ON "daily_closings"("businessDate");

-- CreateIndex
CREATE INDEX "bank_statement_lines_status_idx" ON "bank_statement_lines"("status");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_bankAccountVerifiedByStaffId_fkey" FOREIGN KEY ("bankAccountVerifiedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdByIdentityId_fkey" FOREIGN KEY ("createdByIdentityId") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_investments" ADD CONSTRAINT "company_investments_recordedByIdentityId_fkey" FOREIGN KEY ("recordedByIdentityId") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "supplier_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recordedByStaffId_fkey" FOREIGN KEY ("recordedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_closedByStaffId_fkey" FOREIGN KEY ("closedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_importedByStaffId_fkey" FOREIGN KEY ("importedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
