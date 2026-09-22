-- Phase 13 — AI layer. Adds an "AI" IntegrationCategory value so the AI
-- provider's API key/model/limits reuse the existing IntegrationCredential
-- table and /admin/integrations UI rather than a parallel settings
-- mechanism, plus AiUsageLog: an audit trail of requests to the AI layer
-- itself (who asked, which provider/model answered, whether it matched a
-- known analytics query) — never the actual business data an answer
-- surfaced, which is already covered by whatever service executed the
-- matched query.

-- AlterEnum
ALTER TYPE "IntegrationCategory" ADD VALUE 'AI';

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'ERROR');

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "identityId" TEXT,
    "companyId" TEXT,
    "requestType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "question" TEXT NOT NULL,
    "matchedQuery" TEXT,
    "status" "AiUsageStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_logs_companyId_idx" ON "ai_usage_logs"("companyId");
CREATE INDEX "ai_usage_logs_identityId_idx" ON "ai_usage_logs"("identityId");
CREATE INDEX "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
