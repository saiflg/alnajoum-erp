-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccessReviewStatus" AS ENUM ('OPEN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AccessReviewDecision" AS ENUM ('PENDING', 'KEEP', 'REVOKE');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('EXPORT', 'ERASURE');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('COMPLETED', 'REFUSED');

-- CreateEnum
CREATE TYPE "BreakGlassStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'EXPIRED', 'REVOKED', 'DENIED');

-- CreateTable
CREATE TABLE "security_incidents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedByIdentityId" TEXT NOT NULL,
    "assignedToIdentityId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "personalDataInvolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_incident_notes" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorIdentityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "statusChange" "IncidentStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_incident_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_reviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'OPEN',
    "startedByIdentityId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedByIdentityId" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_review_items" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "roles" TEXT[],
    "lastLoginAt" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "decision" "AccessReviewDecision" NOT NULL DEFAULT 'PENDING',
    "decidedByIdentityId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "access_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL,
    "handledByIdentityId" TEXT NOT NULL,
    "outcome" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_grants" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "BreakGlassStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMinutes" INTEGER NOT NULL,
    "approvedByIdentityId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "break_glass_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_incidents_companyId_status_idx" ON "security_incidents"("companyId", "status");

-- CreateIndex
CREATE INDEX "security_incidents_severity_idx" ON "security_incidents"("severity");

-- CreateIndex
CREATE INDEX "security_incident_notes_incidentId_createdAt_idx" ON "security_incident_notes"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "access_reviews_companyId_status_idx" ON "access_reviews"("companyId", "status");

-- CreateIndex
CREATE INDEX "access_review_items_reviewId_idx" ON "access_review_items"("reviewId");

-- CreateIndex
CREATE INDEX "data_subject_requests_companyId_createdAt_idx" ON "data_subject_requests"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "data_subject_requests_customerId_idx" ON "data_subject_requests"("customerId");

-- CreateIndex
CREATE INDEX "break_glass_grants_status_expiresAt_idx" ON "break_glass_grants"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "break_glass_grants_identityId_idx" ON "break_glass_grants"("identityId");

-- AddForeignKey
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incident_notes" ADD CONSTRAINT "security_incident_notes_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "security_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "access_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

