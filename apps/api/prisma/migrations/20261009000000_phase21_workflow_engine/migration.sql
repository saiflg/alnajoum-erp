-- Phase 21 - workflow automation engine. Additive only: new enums and tables; no existing data is changed.

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'TESTING', 'ACTIVE', 'PAUSED', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "WorkflowExecutionMode" AS ENUM ('LIVE', 'TEST');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'WAITING', 'RETRYING');

-- CreateEnum
CREATE TYPE "WorkflowDeadLetterStatus" AS ENUM ('OPEN', 'RETRIED', 'CANCELLED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WorkflowEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "triggerEvent" TEXT,
    "activeVersionId" TEXT,
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "ownerIdentityId" TEXT,
    "createdByIdentityId" TEXT,
    "updatedByIdentityId" TEXT,
    "scheduleLastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "triggerEvent" TEXT,
    "retryPolicy" JSONB,
    "validation" JSONB,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "changeReason" TEXT,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "companyId" TEXT,
    "branchId" TEXT,
    "actorIdentityId" TEXT,
    "correlationId" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "chain" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "WorkflowEventStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "eventId" TEXT,
    "executionKey" TEXT NOT NULL,
    "mode" "WorkflowExecutionMode" NOT NULL DEFAULT 'LIVE',
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "context" JSONB NOT NULL,
    "waitingFor" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "chain" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "startedByIdentityId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_execution_steps" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'RUNNING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "trace" JSONB,
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "mocked" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_execution_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_dead_letters" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepId" TEXT,
    "nodeId" TEXT,
    "workflowId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "status" "WorkflowDeadLetterStatus" NOT NULL DEFAULT 'OPEN',
    "correlationId" TEXT NOT NULL,
    "resolvedByIdentityId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_rate_counters" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "workflow_rate_counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "workflow_definitions_companyId_status_idx" ON "workflow_definitions"("companyId", "status");

-- CreateIndex
CREATE INDEX "workflow_definitions_triggerEvent_status_idx" ON "workflow_definitions"("triggerEvent", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_companyId_name_key" ON "workflow_definitions"("companyId", "name");

-- CreateIndex
CREATE INDEX "workflow_versions_workflowId_idx" ON "workflow_versions"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflowId_version_key" ON "workflow_versions"("workflowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_events_dedupeKey_key" ON "workflow_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "workflow_events_status_createdAt_idx" ON "workflow_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_events_type_createdAt_idx" ON "workflow_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_events_companyId_createdAt_idx" ON "workflow_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_events_entityType_entityId_idx" ON "workflow_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "workflow_events_correlationId_idx" ON "workflow_events"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_executions_executionKey_key" ON "workflow_executions"("executionKey");

-- CreateIndex
CREATE INDEX "workflow_executions_companyId_status_idx" ON "workflow_executions"("companyId", "status");

-- CreateIndex
CREATE INDEX "workflow_executions_status_nextRunAt_idx" ON "workflow_executions"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "workflow_executions_workflowId_startedAt_idx" ON "workflow_executions"("workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "workflow_executions_entityType_entityId_idx" ON "workflow_executions"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "workflow_executions_correlationId_idx" ON "workflow_executions"("correlationId");

-- CreateIndex
CREATE INDEX "workflow_execution_steps_executionId_idx" ON "workflow_execution_steps"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_steps_executionId_nodeId_key" ON "workflow_execution_steps"("executionId", "nodeId");

-- CreateIndex
CREATE INDEX "workflow_dead_letters_companyId_status_idx" ON "workflow_dead_letters"("companyId", "status");

-- CreateIndex
CREATE INDEX "workflow_dead_letters_executionId_idx" ON "workflow_dead_letters"("executionId");

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_execution_steps" ADD CONSTRAINT "workflow_execution_steps_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_dead_letters" ADD CONSTRAINT "workflow_dead_letters_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
