-- CreateEnum
CREATE TYPE "StaffIdCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REPLACED');

-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "CommContactKind" AS ENUM ('CUSTOMER', 'STAFF', 'LEAD', 'SUBSCRIBER', 'OTHER');

-- CreateEnum
CREATE TYPE "CommContactStatus" AS ENUM ('ACTIVE', 'MERGED', 'ERASED');

-- CreateEnum
CREATE TYPE "CommIdentifierType" AS ENUM ('PHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "CommSubscriptionStatus" AS ENUM ('NONE', 'PENDING_CONFIRMATION', 'SUBSCRIBED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "CommConsentAction" AS ENUM ('REQUESTED', 'GRANTED', 'CONFIRMED', 'WITHDRAWN', 'DENIED');

-- CreateEnum
CREATE TYPE "CommSuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINT', 'INVALID_ADDRESS', 'ADMIN');

-- CreateEnum
CREATE TYPE "CommSegmentKind" AS ENUM ('DYNAMIC', 'STATIC');

-- CreateEnum
CREATE TYPE "CommTemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'TRANSACTIONAL');

-- CreateEnum
CREATE TYPE "CommTemplateApproval" AS ENUM ('NOT_REQUIRED', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED');

-- CreateEnum
CREATE TYPE "CommCampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommRecipientStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'UNCERTAIN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommDeliveryEventType" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED', 'BOUNCED', 'COMPLAINT', 'CLICKED', 'UNSUBSCRIBED');

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "photoFilename" TEXT;

-- CreateTable
CREATE TABLE "staff_id_cards" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "status" "StaffIdCardStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "replacedByCardId" TEXT,
    "printedCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" TIMESTAMP(3),
    "expiryNoticeSentAt" TIMESTAMP(3),
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_id_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_id_card_events" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "StaffIdCardStatus",
    "toStatus" "StaffIdCardStatus",
    "reason" TEXT,
    "actorIdentityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_id_card_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_id_card_scans" (
    "id" TEXT NOT NULL,
    "cardId" TEXT,
    "companyId" TEXT,
    "result" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "scannedByIdentityId" TEXT,
    "ipFingerprint" TEXT,
    "userAgent" TEXT,
    "queryHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_id_card_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_card_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT 'Alnajoum Travel Agency',
    "tagline" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0f172a',
    "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "logoFilename" TEXT,
    "signatureFilename" TEXT,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "contactAddress" TEXT,
    "website" TEXT,
    "officialRegistrationLine" TEXT,
    "emergencyContact" TEXT,
    "lostCardNotice" TEXT NOT NULL DEFAULT 'If this card is lost or stolen, report it to your branch manager or the office immediately so it can be deactivated.',
    "validityMonths" INTEGER NOT NULL DEFAULT 24,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "updatedByIdentityId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_card_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "fullName" TEXT NOT NULL,
    "primaryPhone" TEXT,
    "primaryEmail" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "country" TEXT,
    "source" TEXT NOT NULL,
    "kind" "CommContactKind" NOT NULL DEFAULT 'OTHER',
    "status" "CommContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT,
    "leadId" TEXT,
    "staffId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferenceToken" TEXT NOT NULL,
    "mergedIntoId" TEXT,
    "lastCommunicatedAt" TIMESTAMP(3),
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_contact_channels" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CommIdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_contact_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_subscriptions" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "status" "CommSubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subscribedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "lastRecordId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_consent_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "action" "CommConsentAction" NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "textVersion" TEXT,
    "text" TEXT,
    "evidence" JSONB,
    "actorIdentityId" TEXT,
    "confirmTokenHash" TEXT,
    "confirmExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_suppressions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "valueHash" TEXT NOT NULL,
    "valueHint" TEXT NOT NULL,
    "reason" "CommSuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "contactId" TEXT,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedReason" TEXT,

    CONSTRAINT "comm_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_segments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "CommSegmentKind" NOT NULL DEFAULT 'DYNAMIC',
    "definition" JSONB NOT NULL,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_segment_members" (
    "segmentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_segment_members_pkey" PRIMARY KEY ("segmentId","contactId")
);

-- CreateTable
CREATE TABLE "comm_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "category" "CommTemplateCategory" NOT NULL DEFAULT 'MARKETING',
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "whatsappTemplateName" TEXT,
    "providerTemplateId" TEXT,
    "approval" "CommTemplateApproval" NOT NULL DEFAULT 'NOT_REQUIRED',
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_campaigns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channel" "CommChannel" NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'general',
    "status" "CommCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "segmentId" TEXT,
    "templateId" TEXT,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "variables" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "totalSelected" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "exclusionBreakdown" JSONB,
    "audienceFrozenAt" TIMESTAMP(3),
    "createdByIdentityId" TEXT,
    "approvedByIdentityId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "rejectedReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "CommRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "skipReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "comm_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_delivery_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "channel" "CommChannel" NOT NULL,
    "type" "CommDeliveryEventType" NOT NULL,
    "providerMessageId" TEXT,
    "providerEventId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "comm_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT 'Alnajoum Travel Agency',
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "businessTimezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "whatsappMessagesPerMinute" INTEGER NOT NULL DEFAULT 30,
    "emailMessagesPerMinute" INTEGER NOT NULL DEFAULT 60,
    "dailySendCap" INTEGER NOT NULL DEFAULT 5000,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "testRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "doubleOptInEmail" BOOLEAN NOT NULL DEFAULT true,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "maxCampaignSizeByRole" JSONB NOT NULL,
    "privacyNoticeUrl" TEXT,
    "consentTextVersion" TEXT NOT NULL DEFAULT '1',
    "consentTextWhatsApp" TEXT NOT NULL DEFAULT 'I agree to receive marketing messages from Alnajoum Travel Agency on WhatsApp. I can reply STOP at any time to unsubscribe.',
    "consentTextEmail" TEXT NOT NULL DEFAULT 'I agree to receive marketing emails from Alnajoum Travel Agency. I can unsubscribe at any time using the link in every email.',
    "topics" JSONB NOT NULL,
    "aiMayUseContactData" BOOLEAN NOT NULL DEFAULT false,
    "updatedByIdentityId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_notification_policies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateKey" TEXT NOT NULL,
    "updatedByIdentityId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comm_notification_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_transactional_messages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "customerId" TEXT,
    "contactId" TEXT,
    "templateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "providerMessageId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_transactional_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_inbound_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "channel" "CommChannel" NOT NULL DEFAULT 'WHATSAPP',
    "providerMessageId" TEXT NOT NULL,
    "contactId" TEXT,
    "intent" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_inbound_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_cards_cardNumber_key" ON "staff_id_cards"("cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_cards_verificationToken_key" ON "staff_id_cards"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_cards_replacedByCardId_key" ON "staff_id_cards"("replacedByCardId");

-- CreateIndex
CREATE INDEX "staff_id_cards_companyId_status_idx" ON "staff_id_cards"("companyId", "status");

-- CreateIndex
CREATE INDEX "staff_id_cards_staffId_idx" ON "staff_id_cards"("staffId");

-- CreateIndex
CREATE INDEX "staff_id_cards_expiresAt_idx" ON "staff_id_cards"("expiresAt");

-- CreateIndex
CREATE INDEX "staff_id_card_events_cardId_createdAt_idx" ON "staff_id_card_events"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_id_card_scans_cardId_createdAt_idx" ON "staff_id_card_scans"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_id_card_scans_companyId_createdAt_idx" ON "staff_id_card_scans"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_id_card_scans_result_createdAt_idx" ON "staff_id_card_scans"("result", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_card_settings_companyId_key" ON "staff_card_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_contacts_customerId_key" ON "comm_contacts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_contacts_staffId_key" ON "comm_contacts"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_contacts_preferenceToken_key" ON "comm_contacts"("preferenceToken");

-- CreateIndex
CREATE INDEX "comm_contacts_companyId_status_idx" ON "comm_contacts"("companyId", "status");

-- CreateIndex
CREATE INDEX "comm_contacts_companyId_kind_idx" ON "comm_contacts"("companyId", "kind");

-- CreateIndex
CREATE INDEX "comm_contacts_companyId_preferredLanguage_idx" ON "comm_contacts"("companyId", "preferredLanguage");

-- CreateIndex
CREATE INDEX "comm_contacts_leadId_idx" ON "comm_contacts"("leadId");

-- CreateIndex
CREATE INDEX "comm_contact_channels_contactId_idx" ON "comm_contact_channels"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_contact_channels_companyId_type_value_key" ON "comm_contact_channels"("companyId", "type", "value");

-- CreateIndex
CREATE INDEX "comm_subscriptions_companyId_channel_status_idx" ON "comm_subscriptions"("companyId", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comm_subscriptions_contactId_channel_key" ON "comm_subscriptions"("contactId", "channel");

-- CreateIndex
CREATE INDEX "comm_consent_records_contactId_createdAt_idx" ON "comm_consent_records"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "comm_consent_records_confirmTokenHash_idx" ON "comm_consent_records"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "comm_consent_records_companyId_createdAt_idx" ON "comm_consent_records"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "comm_suppressions_companyId_channel_liftedAt_idx" ON "comm_suppressions"("companyId", "channel", "liftedAt");

-- CreateIndex
CREATE UNIQUE INDEX "comm_suppressions_companyId_channel_valueHash_key" ON "comm_suppressions"("companyId", "channel", "valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "comm_segments_companyId_name_key" ON "comm_segments"("companyId", "name");

-- CreateIndex
CREATE INDEX "comm_templates_companyId_channel_idx" ON "comm_templates"("companyId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "comm_templates_companyId_key_language_key" ON "comm_templates"("companyId", "key", "language");

-- CreateIndex
CREATE INDEX "comm_campaigns_companyId_status_idx" ON "comm_campaigns"("companyId", "status");

-- CreateIndex
CREATE INDEX "comm_campaigns_status_scheduledAt_idx" ON "comm_campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "comm_campaign_recipients_status_nextAttemptAt_idx" ON "comm_campaign_recipients"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "comm_campaign_recipients_providerMessageId_idx" ON "comm_campaign_recipients"("providerMessageId");

-- CreateIndex
CREATE INDEX "comm_campaign_recipients_campaignId_status_idx" ON "comm_campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comm_campaign_recipients_campaignId_contactId_key" ON "comm_campaign_recipients"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "comm_delivery_events_campaignId_type_idx" ON "comm_delivery_events"("campaignId", "type");

-- CreateIndex
CREATE INDEX "comm_delivery_events_providerMessageId_idx" ON "comm_delivery_events"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_delivery_events_channel_providerEventId_key" ON "comm_delivery_events"("channel", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_webhook_events_provider_eventId_key" ON "comm_webhook_events"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_settings_companyId_key" ON "comm_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "comm_notification_policies_companyId_eventType_channel_key" ON "comm_notification_policies"("companyId", "eventType", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "comm_transactional_messages_idempotencyKey_key" ON "comm_transactional_messages"("idempotencyKey");

-- CreateIndex
CREATE INDEX "comm_transactional_messages_companyId_createdAt_idx" ON "comm_transactional_messages"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "comm_transactional_messages_customerId_idx" ON "comm_transactional_messages"("customerId");

-- CreateIndex
CREATE INDEX "comm_inbound_logs_companyId_createdAt_idx" ON "comm_inbound_logs"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "comm_inbound_logs_channel_providerMessageId_key" ON "comm_inbound_logs"("channel", "providerMessageId");

-- AddForeignKey
ALTER TABLE "staff_id_cards" ADD CONSTRAINT "staff_id_cards_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_id_cards" ADD CONSTRAINT "staff_id_cards_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_id_cards" ADD CONSTRAINT "staff_id_cards_replacedByCardId_fkey" FOREIGN KEY ("replacedByCardId") REFERENCES "staff_id_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_id_card_events" ADD CONSTRAINT "staff_id_card_events_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "staff_id_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_id_card_scans" ADD CONSTRAINT "staff_id_card_scans_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "staff_id_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_card_settings" ADD CONSTRAINT "staff_card_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_contacts" ADD CONSTRAINT "comm_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_contacts" ADD CONSTRAINT "comm_contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_contacts" ADD CONSTRAINT "comm_contacts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_contacts" ADD CONSTRAINT "comm_contacts_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_contacts" ADD CONSTRAINT "comm_contacts_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "comm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_contact_channels" ADD CONSTRAINT "comm_contact_channels_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "comm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_subscriptions" ADD CONSTRAINT "comm_subscriptions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "comm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_consent_records" ADD CONSTRAINT "comm_consent_records_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "comm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_suppressions" ADD CONSTRAINT "comm_suppressions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_segments" ADD CONSTRAINT "comm_segments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_segment_members" ADD CONSTRAINT "comm_segment_members_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "comm_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_segment_members" ADD CONSTRAINT "comm_segment_members_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "comm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_templates" ADD CONSTRAINT "comm_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_campaigns" ADD CONSTRAINT "comm_campaigns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_campaigns" ADD CONSTRAINT "comm_campaigns_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "comm_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_campaigns" ADD CONSTRAINT "comm_campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "comm_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_campaign_recipients" ADD CONSTRAINT "comm_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "comm_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_campaign_recipients" ADD CONSTRAINT "comm_campaign_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "comm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_settings" ADD CONSTRAINT "comm_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_notification_policies" ADD CONSTRAINT "comm_notification_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
