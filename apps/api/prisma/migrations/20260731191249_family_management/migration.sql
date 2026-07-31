-- CreateEnum
CREATE TYPE "FamilyRelationship" AS ENUM ('SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'GUARDIAN', 'OTHER');

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "relationship" "FamilyRelationship" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "passportNumber" TEXT,
    "passportExpiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_member_documents" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_member_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_members_customerId_idx" ON "family_members"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "family_member_documents_storedFileName_key" ON "family_member_documents"("storedFileName");

-- CreateIndex
CREATE INDEX "family_member_documents_familyMemberId_idx" ON "family_member_documents"("familyMemberId");

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_member_documents" ADD CONSTRAINT "family_member_documents_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
