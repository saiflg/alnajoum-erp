-- CreateEnum
CREATE TYPE "NfcChipType" AS ENUM ('NTAG213', 'NTAG215', 'NTAG216', 'NTAG424_DNA', 'MIFARE_DESFIRE_EV2', 'MIFARE_DESFIRE_EV3', 'MIFARE_CLASSIC_1K', 'OTHER');

-- CreateEnum
CREATE TYPE "NfcEncodingStatus" AS ENUM ('PREPARED', 'ENCODED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "NfcReaderAdapter" AS ENUM ('WEB_NFC', 'KEYBOARD_WEDGE', 'PCSC_BRIDGE', 'VENDOR_SDK', 'ANDROID_APP', 'MOCK');

-- AlterTable
ALTER TABLE "staff_id_card_scans" ADD COLUMN     "assurance" TEXT,
ADD COLUMN     "readerId" TEXT,
ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "nfc_card_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chipType" "NfcChipType" NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT '13.56 MHz ISO/IEC 14443',
    "cardStock" TEXT,
    "readerModel" TEXT,
    "compatibilityNotes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfc_card_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfc_reader_devices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "adapter" "NfcReaderAdapter" NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastCardAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfc_reader_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_id_card_nfc" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "ndefUrl" TEXT NOT NULL,
    "uidHash" TEXT,
    "uidHint" TEXT,
    "batch" TEXT,
    "status" "NfcEncodingStatus" NOT NULL DEFAULT 'PREPARED',
    "encodedAt" TIMESTAMP(3),
    "encodedByIdentityId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdByIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_id_card_nfc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nfc_card_profiles_companyId_name_key" ON "nfc_card_profiles"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "nfc_reader_devices_tokenHash_key" ON "nfc_reader_devices"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "nfc_reader_devices_companyId_name_key" ON "nfc_reader_devices"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_card_nfc_cardId_key" ON "staff_id_card_nfc"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_card_nfc_reference_key" ON "staff_id_card_nfc"("reference");

-- CreateIndex
CREATE INDEX "staff_id_card_nfc_companyId_status_idx" ON "staff_id_card_nfc"("companyId", "status");

-- CreateIndex
CREATE INDEX "staff_id_card_nfc_companyId_uidHash_idx" ON "staff_id_card_nfc"("companyId", "uidHash");

-- CreateIndex
CREATE INDEX "staff_id_card_nfc_batch_idx" ON "staff_id_card_nfc"("batch");

-- AddForeignKey
ALTER TABLE "nfc_card_profiles" ADD CONSTRAINT "nfc_card_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfc_reader_devices" ADD CONSTRAINT "nfc_reader_devices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_id_card_nfc" ADD CONSTRAINT "staff_id_card_nfc_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "staff_id_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_id_card_nfc" ADD CONSTRAINT "staff_id_card_nfc_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "nfc_card_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
