-- Phase 18: Enterprise mobile app foundation
-- Device registration, push-notification channel, backend-controlled app
-- config (version/force-update/maintenance mode), and self-service
-- password reset (no account-recovery flow existed before this phase).

-- CreateEnum
CREATE TYPE "MobilePlatform" AS ENUM ('IOS', 'ANDROID');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PASSWORD_RESET';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "pushEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "appVersion" TEXT NOT NULL,
    "osVersion" TEXT,
    "pushToken" TEXT,
    "pushProvider" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_app_configs" (
    "id" TEXT NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "minSupportedVersion" TEXT NOT NULL,
    "recommendedVersion" TEXT NOT NULL,
    "forceUpdate" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_app_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_identityId_idx" ON "password_reset_tokens"("identityId");

-- CreateIndex
CREATE INDEX "mobile_devices_identityId_idx" ON "mobile_devices"("identityId");

-- CreateIndex
CREATE INDEX "mobile_devices_pushToken_idx" ON "mobile_devices"("pushToken");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_identityId_deviceId_key" ON "mobile_devices"("identityId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_app_configs_platform_key" ON "mobile_app_configs"("platform");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
