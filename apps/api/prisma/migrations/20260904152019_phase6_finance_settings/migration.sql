-- CreateTable
CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "payoutApprovalTier1Max" INTEGER NOT NULL DEFAULT 100000,
    "payoutApprovalTier2Max" INTEGER NOT NULL DEFAULT 500000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);
