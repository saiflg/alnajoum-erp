-- CreateTable
CREATE TABLE "room_allocations" (
    "id" TEXT NOT NULL,
    "hajjGroupId" TEXT,
    "umrahGroupId" TEXT,
    "hotelName" TEXT NOT NULL,
    "roomType" TEXT,
    "roomNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_allocation_occupants" (
    "id" TEXT NOT NULL,
    "roomAllocationId" TEXT NOT NULL,
    "pilgrimType" "PilgrimType" NOT NULL,
    "pilgrimId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_allocation_occupants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_allocations_hajjGroupId_idx" ON "room_allocations"("hajjGroupId");

-- CreateIndex
CREATE INDEX "room_allocations_umrahGroupId_idx" ON "room_allocations"("umrahGroupId");

-- CreateIndex
CREATE INDEX "room_allocation_occupants_pilgrimType_pilgrimId_idx" ON "room_allocation_occupants"("pilgrimType", "pilgrimId");

-- CreateIndex
CREATE UNIQUE INDEX "room_allocation_occupants_roomAllocationId_pilgrimType_pilg_key" ON "room_allocation_occupants"("roomAllocationId", "pilgrimType", "pilgrimId");

-- AddForeignKey
ALTER TABLE "room_allocations" ADD CONSTRAINT "room_allocations_hajjGroupId_fkey" FOREIGN KEY ("hajjGroupId") REFERENCES "hajj_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_allocations" ADD CONSTRAINT "room_allocations_umrahGroupId_fkey" FOREIGN KEY ("umrahGroupId") REFERENCES "umrah_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_allocation_occupants" ADD CONSTRAINT "room_allocation_occupants_roomAllocationId_fkey" FOREIGN KEY ("roomAllocationId") REFERENCES "room_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

