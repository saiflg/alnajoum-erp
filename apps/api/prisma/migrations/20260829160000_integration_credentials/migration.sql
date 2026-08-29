-- CreateEnum
CREATE TYPE "IntegrationCategory" AS ENUM ('FLIGHT', 'PAYMENT', 'NOTIFICATION');

-- AlterEnum
ALTER TYPE "FlightProviderName" ADD VALUE 'SABRE';
ALTER TYPE "FlightProviderName" ADD VALUE 'AMADEUS';

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" TEXT NOT NULL,
    "category" "IntegrationCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_credentials_category_idx" ON "integration_credentials"("category");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_category_provider_key" ON "integration_credentials"("category", "provider");
