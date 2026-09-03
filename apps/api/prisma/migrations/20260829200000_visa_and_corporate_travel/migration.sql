-- CreateEnum
CREATE TYPE "VisaType" AS ENUM ('TOURIST', 'BUSINESS', 'STUDENT', 'WORK', 'TRANSIT', 'PILGRIMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "VisaApplicationStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'ADDITIONAL_DOCUMENTS_REQUIRED', 'APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorporateBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'VISA_APPLICATION_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "corporateBookingId" TEXT,
ADD COLUMN     "visaApplicationId" TEXT;

-- CreateTable
CREATE TABLE "visa_applications" (
    "id" TEXT NOT NULL,
    "applicationReference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "familyMemberId" TEXT,
    "appliedByStaffId" TEXT,
    "destinationCountry" TEXT NOT NULL,
    "visaType" "VisaType" NOT NULL,
    "intendedTravelDate" TIMESTAMP(3),
    "applicantFirstName" TEXT NOT NULL,
    "applicantLastName" TEXT NOT NULL,
    "applicantPassportNumber" TEXT,
    "status" "VisaApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "staffNote" TEXT,
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "billingAddress" TEXT,
    "contactPersonName" TEXT,
    "managedBranchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_travelers" (
    "id" TEXT NOT NULL,
    "corporateAccountId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "passportNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_travelers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_bookings" (
    "id" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "corporateAccountId" TEXT NOT NULL,
    "bookedByStaffId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CorporateBookingStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_booking_travelers" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "travelerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "corporate_booking_travelers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visa_applications_applicationReference_key" ON "visa_applications"("applicationReference");

-- CreateIndex
CREATE INDEX "visa_applications_customerId_idx" ON "visa_applications"("customerId");

-- CreateIndex
CREATE INDEX "visa_applications_familyMemberId_idx" ON "visa_applications"("familyMemberId");

-- CreateIndex
CREATE INDEX "visa_applications_status_idx" ON "visa_applications"("status");

-- CreateIndex
CREATE INDEX "corporate_accounts_managedBranchId_idx" ON "corporate_accounts"("managedBranchId");

-- CreateIndex
CREATE INDEX "corporate_travelers_corporateAccountId_idx" ON "corporate_travelers"("corporateAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_bookings_bookingReference_key" ON "corporate_bookings"("bookingReference");

-- CreateIndex
CREATE INDEX "corporate_bookings_corporateAccountId_idx" ON "corporate_bookings"("corporateAccountId");

-- CreateIndex
CREATE INDEX "corporate_bookings_bookedByStaffId_idx" ON "corporate_bookings"("bookedByStaffId");

-- CreateIndex
CREATE INDEX "corporate_bookings_status_idx" ON "corporate_bookings"("status");

-- CreateIndex
CREATE INDEX "corporate_booking_travelers_bookingId_idx" ON "corporate_booking_travelers"("bookingId");

-- CreateIndex
CREATE INDEX "corporate_booking_travelers_travelerId_idx" ON "corporate_booking_travelers"("travelerId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_visaApplicationId_key" ON "invoices"("visaApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_corporateBookingId_key" ON "invoices"("corporateBookingId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_corporateBookingId_fkey" FOREIGN KEY ("corporateBookingId") REFERENCES "corporate_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_appliedByStaffId_fkey" FOREIGN KEY ("appliedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_accounts" ADD CONSTRAINT "corporate_accounts_managedBranchId_fkey" FOREIGN KEY ("managedBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_travelers" ADD CONSTRAINT "corporate_travelers_corporateAccountId_fkey" FOREIGN KEY ("corporateAccountId") REFERENCES "corporate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_bookings" ADD CONSTRAINT "corporate_bookings_corporateAccountId_fkey" FOREIGN KEY ("corporateAccountId") REFERENCES "corporate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_bookings" ADD CONSTRAINT "corporate_bookings_bookedByStaffId_fkey" FOREIGN KEY ("bookedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_booking_travelers" ADD CONSTRAINT "corporate_booking_travelers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "corporate_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_booking_travelers" ADD CONSTRAINT "corporate_booking_travelers_travelerId_fkey" FOREIGN KEY ("travelerId") REFERENCES "corporate_travelers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

