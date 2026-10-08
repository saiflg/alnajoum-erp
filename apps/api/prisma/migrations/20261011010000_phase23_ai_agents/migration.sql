-- CreateEnum
CREATE TYPE "AiAgentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiAgentVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AiExecutionStatus" AS ENUM ('RUNNING', 'WAITING_APPROVAL', 'WAITING_CUSTOMER', 'COMPLETED', 'FAILED', 'ESCALATED', 'CANCELLED', 'HANDED_OFF', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiStepKind" AS ENUM ('MODEL', 'TOOL', 'APPROVAL', 'DELEGATION', 'GUARD', 'ESCALATION');

-- CreateEnum
CREATE TYPE "AiStepStatus" AS ENUM ('OK', 'ERROR', 'DENIED', 'PENDING_APPROVAL', 'SIMULATED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AiRiskLevel" AS ENUM ('READ_ONLY', 'LOW_RISK_WRITE', 'MEDIUM_RISK', 'HIGH_RISK');

-- CreateEnum
CREATE TYPE "AiApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiMemoryType" AS ENUM ('SHORT_TERM', 'OPERATIONAL', 'PREFERENCE', 'KNOWLEDGE', 'HISTORICAL');

-- CreateEnum
CREATE TYPE "AiFeedbackRating" AS ENUM ('CORRECT', 'INCORRECT', 'PARTIAL', 'UNSAFE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AiControlKind" AS ENUM ('ALL_DISABLED', 'AGENT_DISABLED', 'TOOL_DISABLED', 'AUTONOMOUS_DISABLED', 'FORCE_APPROVAL', 'AUTONOMY_CAP', 'FEATURE_FLAG', 'COMM_POLICY');

-- CreateEnum
CREATE TYPE "AiBudgetPeriod" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AiConversationStatus" AS ENUM ('AI_ACTIVE', 'PAUSED', 'HUMAN_TAKEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('CUSTOMER', 'AI', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiRecommendationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AiSafetyEventKind" AS ENUM ('PROMPT_INJECTION', 'UNAUTHORIZED_ACTION', 'APPROVAL_BYPASS', 'SECRET_REQUEST', 'TENANT_ESCAPE', 'POLICY_VIOLATION', 'LOOP_DETECTED', 'BUDGET_EXCEEDED', 'UNVERIFIED_NUMBER', 'KILL_SWITCH');

-- AlterTable
-- Aligns the database with the schema (the column was always optional in the model).
ALTER TABLE "customers" ALTER COLUMN "preferredLanguage" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "status" "AiAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "AiAgentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeNote" TEXT,
    "createdByIdentityId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "companyId" TEXT,
    "branchId" TEXT,
    "initiatorIdentityId" TEXT,
    "customerId" TEXT,
    "conversationId" TEXT,
    "parentExecutionId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "objective" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT,
    "model" TEXT,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "confidence" TEXT,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_execution_steps" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "AiStepKind" NOT NULL,
    "toolKey" TEXT,
    "risk" "AiRiskLevel",
    "status" "AiStepStatus" NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_execution_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "executionId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approvals" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "companyId" TEXT,
    "branchId" TEXT,
    "toolKey" TEXT NOT NULL,
    "risk" "AiRiskLevel" NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "reason" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "editedParams" JSONB,
    "preview" JSONB NOT NULL,
    "financialImpact" JSONB,
    "customerImpact" TEXT,
    "requiredRole" TEXT,
    "status" "AiApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvalRequestId" TEXT,
    "initiatorIdentityId" TEXT,
    "decidedByIdentityId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "AiMemoryType" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_sources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "branchId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceLabel" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "executionId" TEXT,
    "messageId" TEXT,
    "rating" "AiFeedbackRating" NOT NULL,
    "note" TEXT,
    "ratedByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_controls" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "kind" "AiControlKind" NOT NULL,
    "targetKey" TEXT NOT NULL DEFAULT '',
    "value" JSONB,
    "reason" TEXT,
    "setByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budgets" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL DEFAULT '',
    "period" "AiBudgetPeriod" NOT NULL,
    "maxTokens" INTEGER,
    "maxRequests" INTEGER,
    "maxCostMicros" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "alertedPeriodKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "identityId" TEXT,
    "channel" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" "AiConversationStatus" NOT NULL DEFAULT 'AI_ACTIVE',
    "assignedStaffId" TEXT,
    "humanTakenAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT,
    "executionId" TEXT,
    "confidence" TEXT,
    "sources" JSONB,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "agentKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "suggestedAction" JSONB,
    "priorityScore" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "AiRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "subjectType" TEXT,
    "subjectId" TEXT,
    "dueAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_safety_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "executionId" TEXT,
    "agentKey" TEXT,
    "identityId" TEXT,
    "kind" "AiSafetyEventKind" NOT NULL,
    "severity" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "securityIncidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_safety_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_briefings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_key_key" ON "ai_agents"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_currentVersionId_key" ON "ai_agents"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_versions_agentId_version_key" ON "ai_agent_versions"("agentId", "version");

-- CreateIndex
CREATE INDEX "ai_executions_companyId_startedAt_idx" ON "ai_executions"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "ai_executions_agentId_startedAt_idx" ON "ai_executions"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "ai_executions_correlationId_idx" ON "ai_executions"("correlationId");

-- CreateIndex
CREATE INDEX "ai_executions_status_idx" ON "ai_executions"("status");

-- CreateIndex
CREATE INDEX "ai_executions_conversationId_idx" ON "ai_executions"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_execution_steps_executionId_seq_key" ON "ai_execution_steps"("executionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ai_action_records_companyId_idempotencyKey_key" ON "ai_action_records"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_approvals_approvalRequestId_key" ON "ai_approvals"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ai_approvals_companyId_status_idx" ON "ai_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "ai_approvals_executionId_idx" ON "ai_approvals"("executionId");

-- CreateIndex
CREATE INDEX "ai_memories_companyId_subjectType_subjectId_idx" ON "ai_memories"("companyId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_memories_companyId_type_subjectType_subjectId_key_key" ON "ai_memories"("companyId", "type", "subjectType", "subjectId", "key");

-- CreateIndex
CREATE INDEX "ai_knowledge_sources_companyId_category_status_idx" ON "ai_knowledge_sources"("companyId", "category", "status");

-- CreateIndex
CREATE INDEX "ai_feedback_companyId_createdAt_idx" ON "ai_feedback"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_feedback_executionId_idx" ON "ai_feedback"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_controls_scopeKey_kind_targetKey_key" ON "ai_controls"("scopeKey", "kind", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_budgets_scopeKey_agentKey_period_key" ON "ai_budgets"("scopeKey", "agentKey", "period");

-- CreateIndex
CREATE INDEX "ai_conversations_companyId_status_lastMessageAt_idx" ON "ai_conversations"("companyId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ai_conversations_customerId_idx" ON "ai_conversations"("customerId");

-- CreateIndex
CREATE INDEX "ai_conversation_messages_conversationId_createdAt_idx" ON "ai_conversation_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_recommendations_companyId_status_priorityScore_idx" ON "ai_recommendations"("companyId", "status", "priorityScore");

-- CreateIndex
CREATE UNIQUE INDEX "ai_recommendations_companyId_dedupeKey_key" ON "ai_recommendations"("companyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ai_safety_events_companyId_createdAt_idx" ON "ai_safety_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_safety_events_kind_createdAt_idx" ON "ai_safety_events"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_briefings_companyId_businessDate_key" ON "ai_briefings"("companyId", "businessDate");

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ai_agent_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "ai_agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_parentExecutionId_fkey" FOREIGN KEY ("parentExecutionId") REFERENCES "ai_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_steps" ADD CONSTRAINT "ai_execution_steps_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ai_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ai_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ai_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_messages" ADD CONSTRAINT "ai_conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_briefings" ADD CONSTRAINT "ai_briefings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

