import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelBookingStatus, PilgrimType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';
import {
  AssignOccupantDto,
  CreateRoomAllocationDto,
} from './dto/room-allocation.dto';

const ROOM_INCLUDE = {
  occupants: true,
  hotelBooking: {
    select: {
      bookingReference: true,
      city: true,
      starRating: true,
      checkInDate: true,
      checkOutDate: true,
    },
  },
} as const;

// A cancelled/refunded booking is no longer a real reservation — it never
// shows up as something staff can link a room to.
const LINKABLE_STATUSES: HotelBookingStatus[] = [
  HotelBookingStatus.PENDING,
  HotelBookingStatus.CONFIRMED,
  HotelBookingStatus.COMPLETED,
];

/**
 * Spec #16 — room allocation preventing capacity conflicts. Deliberately
 * lightweight (hotelName/roomNumber as free text, not a HotelRoomType FK —
 * see schema.prisma's Phase 8 room-allocation comment) since Hajj/Umrah
 * packages have never been booked through the Phase 5 hotel catalog.
 *
 * "Deeper hotel-catalog integration": a room can optionally link to a real
 * HotelBooking one of the group's pilgrims already has (hotelBookingId).
 * When linked, hotelName is snapshotted from that booking rather than
 * trusted from client input, so the two can never disagree — the room's
 * own roomNumber/capacity/occupants stay Phase 8's concern regardless,
 * since HotelBooking only tracks a room *count*, not individual room
 * numbers or which pilgrim is in which one.
 */
@Injectable()
export class RoomAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pilgrimLookup: PilgrimLookupService,
  ) {}

  async create(dto: CreateRoomAllocationDto) {
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

    let hotelName = dto.hotelName;
    if (dto.hotelBookingId) {
      const booking = await this.prisma.hotelBooking.findUnique({
        where: { id: dto.hotelBookingId },
      });
      if (!booking) {
        throw new NotFoundException('Hotel booking not found');
      }
      // Snapshotted, same "never re-derive from a record that can change
      // later" principle as every other module's *Snapshot field — always
      // wins over whatever hotelName the client sent.
      hotelName = booking.hotelName;
    } else if (!hotelName) {
      throw new BadRequestException(
        'A room allocation needs either a hotelName or a linked hotelBookingId',
      );
    }

    return this.prisma.roomAllocation.create({
      data: {
        hajjGroupId: dto.hajjGroupId,
        umrahGroupId: dto.umrahGroupId,
        hotelBookingId: dto.hotelBookingId,
        hotelName,
        roomType: dto.roomType,
        roomNumber: dto.roomNumber,
        capacity: dto.capacity ?? 2,
      },
    });
  }

  listForGroup(filters: { hajjGroupId?: string; umrahGroupId?: string }) {
    return this.prisma.roomAllocation.findMany({
      where: filters,
      include: ROOM_INCLUDE,
      orderBy: { roomNumber: 'asc' },
    });
  }

  async get(id: string) {
    const room = await this.prisma.roomAllocation.findUnique({
      where: { id },
      include: ROOM_INCLUDE,
    });
    if (!room) throw new NotFoundException('Room allocation not found');
    return room;
  }

  /**
   * Real hotel bookings staff can link a new room to — every non-cancelled
   * HotelBooking belonging to (or with a guest who is) a pilgrim already in
   * this group, the same customerId/familyMemberId matching ReadinessService
   * already uses for hotelAssigned, so "linkable" and "counts toward
   * readiness" always agree.
   */
  async listLinkableHotelBookings(groupType: PilgrimType, groupId: string) {
    const pilgrims =
      groupType === PilgrimType.HAJJ
        ? await this.prisma.hajjRegistrationPilgrim.findMany({
            where: { groupId },
            select: { customerId: true, familyMemberId: true },
          })
        : await this.prisma.umrahRegistrationPilgrim.findMany({
            where: { groupId },
            select: { customerId: true, familyMemberId: true },
          });
    if (pilgrims.length === 0) return [];

    const customerIds = pilgrims
      .map((p) => p.customerId)
      .filter((id): id is string => !!id);
    const familyMemberIds = pilgrims
      .map((p) => p.familyMemberId)
      .filter((id): id is string => !!id);

    return this.prisma.hotelBooking.findMany({
      where: {
        status: { in: LINKABLE_STATUSES },
        OR: [
          { customerId: { in: customerIds } },
          { guestRecords: { some: { customerId: { in: customerIds } } } },
          {
            guestRecords: { some: { familyMemberId: { in: familyMemberIds } } },
          },
        ],
      },
      select: {
        id: true,
        bookingReference: true,
        hotelName: true,
        city: true,
        checkInDate: true,
        checkOutDate: true,
        rooms: true,
      },
      orderBy: { checkInDate: 'asc' },
    });
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
