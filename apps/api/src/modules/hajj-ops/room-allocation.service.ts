import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';
import {
  AssignOccupantDto,
  CreateRoomAllocationDto,
} from './dto/room-allocation.dto';

/**
 * Spec #16 — room allocation preventing capacity conflicts. Deliberately
 * lightweight (hotelName/roomNumber as free text, not a HotelRoomType FK —
 * see schema.prisma's Phase 8 room-allocation header comment) since Hajj/
 * Umrah packages have never been booked through the Phase 5 hotel catalog.
 */
@Injectable()
export class RoomAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pilgrimLookup: PilgrimLookupService,
  ) {}

  create(dto: CreateRoomAllocationDto) {
    if (!dto.hajjGroupId && !dto.umrahGroupId) {
      throw new BadRequestException(
        'A room allocation must reference either a Hajj group or an Umrah group',
      );
    }
    if (dto.hajjGroupId && dto.umrahGroupId) {
      throw new BadRequestException(
        'A room allocation cannot reference both a Hajj group and an Umrah group',
      );
    }
    return this.prisma.roomAllocation.create({
      data: {
        hajjGroupId: dto.hajjGroupId,
        umrahGroupId: dto.umrahGroupId,
        hotelName: dto.hotelName,
        roomType: dto.roomType,
        roomNumber: dto.roomNumber,
        capacity: dto.capacity ?? 2,
      },
    });
  }

  listForGroup(filters: { hajjGroupId?: string; umrahGroupId?: string }) {
    return this.prisma.roomAllocation.findMany({
      where: filters,
      include: { occupants: true },
      orderBy: { roomNumber: 'asc' },
    });
  }

  async get(id: string) {
    const room = await this.prisma.roomAllocation.findUnique({
      where: { id },
      include: { occupants: true },
    });
    if (!room) throw new NotFoundException('Room allocation not found');
    return room;
  }

  /** Assigns a pilgrim to this room, refusing once capacity is reached or the pilgrim is already elsewhere in the same group's rooms. */
  async assignOccupant(roomAllocationId: string, dto: AssignOccupantDto) {
    const room = await this.get(roomAllocationId);
    await this.pilgrimLookup.getPilgrim(dto.pilgrimType, dto.pilgrimId); // 404s if unknown

    if (room.occupants.length >= room.capacity) {
      throw new ConflictException(
        `Room ${room.roomNumber} is at capacity (${room.capacity})`,
      );
    }

    // A pilgrim can't be in two rooms of the same group at once — check
    // every other room in this group, not just this one.
    const siblingRooms = await this.prisma.roomAllocation.findMany({
      where: room.hajjGroupId
        ? { hajjGroupId: room.hajjGroupId }
        : { umrahGroupId: room.umrahGroupId },
      include: { occupants: true },
    });
    const alreadyAssigned = siblingRooms.some((r) =>
      r.occupants.some(
        (o) =>
          o.pilgrimType === dto.pilgrimType && o.pilgrimId === dto.pilgrimId,
      ),
    );
    if (alreadyAssigned) {
      throw new ConflictException(
        'This pilgrim is already assigned to a room in this group',
      );
    }

    const occupant = await this.prisma.roomAllocationOccupant.create({
      data: {
        roomAllocationId,
        pilgrimType: dto.pilgrimType,
        pilgrimId: dto.pilgrimId,
      },
    });
    await this.auditService.record({
      action: 'room_allocation.occupant_assigned',
      entityType: 'RoomAllocation',
      entityId: roomAllocationId,
      metadata: { pilgrimType: dto.pilgrimType, pilgrimId: dto.pilgrimId },
    });
    return occupant;
  }

  async removeOccupant(roomAllocationId: string, occupantId: string) {
    const occupant = await this.prisma.roomAllocationOccupant.findUnique({
      where: { id: occupantId },
    });
    if (!occupant || occupant.roomAllocationId !== roomAllocationId) {
      throw new NotFoundException('Occupant not found in this room');
    }
    return this.prisma.roomAllocationOccupant.delete({
      where: { id: occupantId },
    });
  }

  async checkInOccupant(roomAllocationId: string, occupantId: string) {
    const occupant = await this.prisma.roomAllocationOccupant.findUnique({
      where: { id: occupantId },
    });
    if (!occupant || occupant.roomAllocationId !== roomAllocationId) {
      throw new NotFoundException('Occupant not found in this room');
    }
    return this.prisma.roomAllocationOccupant.update({
      where: { id: occupantId },
      data: { checkedInAt: new Date() },
    });
  }
}
