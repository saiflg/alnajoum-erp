-- CreateEnum
CREATE TYPE "TravelGroupStatus" AS ENUM ('PLANNING', 'REGISTRATION_OPEN', 'ALMOST_FULL', 'FULL', 'DEPARTED', 'IN_SAUDI_ARABIA', 'RETURNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UmrahGroupType" AS ENUM ('INDIVIDUAL', 'FAMILY', 'GROUP', 'CORPORATE', 'VIP');

-- CreateEnum
CREATE TYPE "VehicleFleetType" AS ENUM ('BUS', 'VAN', 'SEDAN', 'SUV', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleFleetStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('AIRPORT_TRANSFER', 'MAKKAH_TRANSPORT', 'MADINAH_TRANSPORT', 'INTERCITY', 'GROUP_BUS', 'PRIVATE_VEHICLE');

-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PilgrimType" AS ENUM ('HAJJ', 'UMRAH');

-- CreateEnum
CREATE TYPE "PilgrimCheckInEvent" AS ENUM ('GROUP_CHECK_IN', 'AIRPORT', 'TRANSPORT', 'HOTEL', 'DEPARTURE');

-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('GREEN', 'AMBER', 'RED');

-- AlterTable
ALTER TABLE "family_members" ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT;

-- AlterTable
ALTER TABLE "hajj_registration_pilgrims" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "pilgrimCode" TEXT;

-- AlterTable
ALTER TABLE "umrah_registration_pilgrims" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "pilgrimCode" TEXT;

-- CreateTable
CREATE TABLE "hajj_groups" (
    "id" TEXT NOT NULL,
    "groupNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packageId" TEXT,
    "status" "TravelGroupStatus" NOT NULL DEFAULT 'PLANNING',
    "departureDate" TIMESTAMP(3),
    "returnDate" TIMESTAMP(3),
    "airline" TEXT,
    "maxCapacity" INTEGER,
    "coordinatorStaffId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "umrah_groups" (
    "id" TEXT NOT NULL,
    "groupNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupType" "UmrahGroupType" NOT NULL DEFAULT 'GROUP',
    "packageId" TEXT,
    "status" "TravelGroupStatus" NOT NULL DEFAULT 'PLANNING',
    "departureDate" TIMESTAMP(3),
    "returnDate" TIMESTAMP(3),
    "airline" TEXT,
    "maxCapacity" INTEGER,
    "coordinatorStaffId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "umrah_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_ops_vehicles" (
    "id" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "type" "VehicleFleetType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "VehicleFleetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_ops_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_ops_drivers" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "vehicleId" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_ops_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_ops_transports" (
    "id" TEXT NOT NULL,
    "type" "TransportType" NOT NULL,
    "hajjGroupId" TEXT,
    "umrahGroupId" TEXT,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "pickupLocation" TEXT NOT NULL,
    "dropoffLocation" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "TransportStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_ops_transports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilgrim_check_ins" (
    "id" TEXT NOT NULL,
    "pilgrimType" "PilgrimType" NOT NULL,
    "pilgrimId" TEXT NOT NULL,
    "event" "PilgrimCheckInEvent" NOT NULL,
    "location" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilgrim_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilgrim_readiness_overrides" (
    "id" TEXT NOT NULL,
    "pilgrimType" "PilgrimType" NOT NULL,
    "pilgrimId" TEXT NOT NULL,
    "status" "ReadinessStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "overriddenByStaffId" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilgrim_readiness_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hajj_groups_groupNumber_key" ON "hajj_groups"("groupNumber");

-- CreateIndex
CREATE INDEX "hajj_groups_packageId_idx" ON "hajj_groups"("packageId");

-- CreateIndex
CREATE INDEX "hajj_groups_status_idx" ON "hajj_groups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "umrah_groups_groupNumber_key" ON "umrah_groups"("groupNumber");

-- CreateIndex
CREATE INDEX "umrah_groups_packageId_idx" ON "umrah_groups"("packageId");

-- CreateIndex
CREATE INDEX "umrah_groups_status_idx" ON "umrah_groups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hajj_ops_vehicles_plateNumber_key" ON "hajj_ops_vehicles"("plateNumber");

-- CreateIndex
CREATE INDEX "hajj_ops_drivers_vehicleId_idx" ON "hajj_ops_drivers"("vehicleId");

-- CreateIndex
CREATE INDEX "hajj_ops_transports_hajjGroupId_idx" ON "hajj_ops_transports"("hajjGroupId");

-- CreateIndex
CREATE INDEX "hajj_ops_transports_umrahGroupId_idx" ON "hajj_ops_transports"("umrahGroupId");

-- CreateIndex
CREATE INDEX "pilgrim_check_ins_pilgrimType_pilgrimId_idx" ON "pilgrim_check_ins"("pilgrimType", "pilgrimId");

-- CreateIndex
CREATE INDEX "pilgrim_readiness_overrides_pilgrimType_pilgrimId_idx" ON "pilgrim_readiness_overrides"("pilgrimType", "pilgrimId");

-- CreateIndex
CREATE UNIQUE INDEX "hajj_registration_pilgrims_pilgrimCode_key" ON "hajj_registration_pilgrims"("pilgrimCode");

-- CreateIndex
CREATE INDEX "hajj_registration_pilgrims_groupId_idx" ON "hajj_registration_pilgrims"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "umrah_registration_pilgrims_pilgrimCode_key" ON "umrah_registration_pilgrims"("pilgrimCode");

-- CreateIndex
CREATE INDEX "umrah_registration_pilgrims_groupId_idx" ON "umrah_registration_pilgrims"("groupId");

-- AddForeignKey
ALTER TABLE "hajj_registration_pilgrims" ADD CONSTRAINT "hajj_registration_pilgrims_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "hajj_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_registration_pilgrims" ADD CONSTRAINT "umrah_registration_pilgrims_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "umrah_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_groups" ADD CONSTRAINT "hajj_groups_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "hajj_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_groups" ADD CONSTRAINT "hajj_groups_coordinatorStaffId_fkey" FOREIGN KEY ("coordinatorStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_groups" ADD CONSTRAINT "umrah_groups_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "umrah_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "umrah_groups" ADD CONSTRAINT "umrah_groups_coordinatorStaffId_fkey" FOREIGN KEY ("coordinatorStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_ops_drivers" ADD CONSTRAINT "hajj_ops_drivers_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "hajj_ops_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_ops_transports" ADD CONSTRAINT "hajj_ops_transports_hajjGroupId_fkey" FOREIGN KEY ("hajjGroupId") REFERENCES "hajj_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_ops_transports" ADD CONSTRAINT "hajj_ops_transports_umrahGroupId_fkey" FOREIGN KEY ("umrahGroupId") REFERENCES "umrah_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_ops_transports" ADD CONSTRAINT "hajj_ops_transports_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "hajj_ops_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_ops_transports" ADD CONSTRAINT "hajj_ops_transports_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "hajj_ops_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_check_ins" ADD CONSTRAINT "pilgrim_check_ins_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilgrim_readiness_overrides" ADD CONSTRAINT "pilgrim_readiness_overrides_overriddenByStaffId_fkey" FOREIGN KEY ("overriddenByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

