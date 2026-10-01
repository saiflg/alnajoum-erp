import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BulkCreateHotelAllotmentDto } from './dto/bulk-create-hotel-allotment.dto';
import { CreateHotelAllotmentDto } from './dto/create-hotel-allotment.dto';
import { UpdateHotelAllotmentDto } from './dto/update-hotel-allotment.dto';

/** Every date in [start, end) at UTC midnight — "end" is the checkout day
 * itself, which is not a booked night (standard hotel night convention). */
function nightsBetween(start: string | Date, end: string | Date): Date[] {
  const nights: Date[] = [];
  const cursor = new Date(start);
  const stop = new Date(end);
  while (cursor < stop) {
    nights.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

/** Every date in [start, end] inclusive — used by the bulk date-range
 * create endpoint, where both ends are calendar days to allocate. */
function daysInclusive(start: string | Date, end: string | Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start);
  const stop = new Date(end);
  while (cursor <= stop) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Phase 17 — day-level room-count inventory for a (platform-wide)
 * HotelRoomType, scoped per tenant via HotelAllotment.companyId exactly
 * like RatePlan. A row only exists for a date once a hotelier has
 * explicitly allocated rooms for it (via create/bulkCreate); an absent row
 * means "no capacity control configured for that room type on that date",
 * not "zero rooms" — see claimNights()'s own comment for how this shapes
 * the booking-time claim.
 */
@Injectable()
export class HotelAllotmentsService {
  private readonly logger = new Logger(HotelAllotmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(
    filters: { roomTypeId?: string; from?: string; to?: string },
    tenantCompanyId?: string,
  ) {
    return this.prisma.hotelAllotment.findMany({
      where: {
        ...(filters.roomTypeId && { roomTypeId: filters.roomTypeId }),
        ...((filters.from || filters.to) && {
          date: {
            ...(filters.from && { gte: new Date(filters.from) }),
            ...(filters.to && { lte: new Date(filters.to) }),
          },
        }),
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      orderBy: { date: 'asc' },
    });
  }

  private async getOwned(id: string, tenantCompanyId?: string) {
    const row = await this.prisma.hotelAllotment.findUnique({ where: { id } });
    if (
      !row ||
      (tenantCompanyId !== undefined && row.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Allotment not found');
    }
    return row;
  }

  async create(
    dto: CreateHotelAllotmentDto,
    companyId: string,
    actorIdentityId: string,
  ) {
    const roomType = await this.prisma.hotelRoomType.findUnique({
      where: { id: dto.roomTypeId },
    });
    if (!roomType) {
      throw new NotFoundException('Room type not found');
    }
    const date = new Date(dto.date);
    const row = await this.prisma.hotelAllotment.upsert({
      where: {
        companyId_roomTypeId_date: {
          companyId,
          roomTypeId: dto.roomTypeId,
          date,
        },
      },
      create: {
        companyId,
        roomTypeId: dto.roomTypeId,
        date,
        totalAllocated: dto.totalAllocated,
        stopSell: dto.stopSell ?? false,
        releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : undefined,
        notes: dto.notes,
      },
      update: {
        totalAllocated: dto.totalAllocated,
        stopSell: dto.stopSell ?? false,
        releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : undefined,
        notes: dto.notes,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel_allotment.created',
      entityType: 'HotelAllotment',
      entityId: row.id,
      companyId,
      metadata: {
        roomTypeId: dto.roomTypeId,
        date: dto.date,
        totalAllocated: dto.totalAllocated,
      },
    });
    return row;
  }

  /** Bulk date-range entry (spec's own "date-range" framing) — upserts one
   * row per day in [startDate, endDate], each keyed on the same
   * (companyId, roomTypeId, date) uniqueness as a single create. */
  async bulkCreate(
    dto: BulkCreateHotelAllotmentDto,
    companyId: string,
    actorIdentityId: string,
  ) {
    const roomType = await this.prisma.hotelRoomType.findUnique({
      where: { id: dto.roomTypeId },
    });
    if (!roomType) {
      throw new NotFoundException('Room type not found');
    }
    const days = daysInclusive(dto.startDate, dto.endDate);
    if (days.length === 0) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    const rows = await this.prisma.$transaction(
      days.map((date) =>
        this.prisma.hotelAllotment.upsert({
          where: {
            companyId_roomTypeId_date: {
              companyId,
              roomTypeId: dto.roomTypeId,
              date,
            },
          },
          create: {
            companyId,
            roomTypeId: dto.roomTypeId,
            date,
            totalAllocated: dto.totalAllocated,
            stopSell: dto.stopSell ?? false,
            notes: dto.notes,
          },
          update: {
            totalAllocated: dto.totalAllocated,
            stopSell: dto.stopSell ?? false,
            notes: dto.notes,
          },
        }),
      ),
    );
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel_allotment.bulk_created',
      entityType: 'HotelAllotment',
      entityId: dto.roomTypeId,
      companyId,
      metadata: {
        roomTypeId: dto.roomTypeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        totalAllocated: dto.totalAllocated,
        days: days.length,
      },
    });
    return rows;
  }

  async update(
    id: string,
    dto: UpdateHotelAllotmentDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.getOwned(id, tenantCompanyId);
    const updated = await this.prisma.hotelAllotment.update({
      where: { id },
      data: {
        ...dto,
        releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel_allotment.updated',
      entityType: 'HotelAllotment',
      entityId: id,
      companyId: existing.companyId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * Booking-time atomic claim, called from inside HotelsService.createBooking's
   * own transaction so a failed claim rolls the whole booking back. Requires
   * EVERY night of the stay to already have a HotelAllotment row — a stay
   * spanning even one unmanaged night is treated as entirely unmanaged
   * (returns false, no rows touched) rather than partially enforced. This
   * keeps releaseNights() symmetric: since a claim only ever succeeds when
   * every night in [checkIn, checkOut) already had a row, releasing that
   * same exact range at cancellation time is always safe, without needing
   * to separately record which individual nights were claimed.
   *
   * The capacity check and the increment happen in one UPDATE so a
   * concurrent claim for the last remaining room can never double-book it
   * (same atomic-claim principle as PaymentsService.finalizeIntent, just
   * checking a computed availability expression instead of a status
   * column, and across every night row at once).
   */
  async claimNights(
    tx: Prisma.TransactionClient,
    companyId: string,
    roomTypeId: string,
    checkInDate: string | Date,
    checkOutDate: string | Date,
    rooms: number,
  ): Promise<boolean> {
    const nights = nightsBetween(checkInDate, checkOutDate);
    if (nights.length === 0) return false;

    const existingCount = await tx.hotelAllotment.count({
      where: { companyId, roomTypeId, date: { in: nights } },
    });
    if (existingCount < nights.length) {
      return false;
    }

    const affected = await tx.$executeRaw`
      UPDATE hotel_allotments
      SET "bookedCount" = "bookedCount" + ${rooms}, "updatedAt" = NOW()
      WHERE "companyId" = ${companyId}
        AND "roomTypeId" = ${roomTypeId}
        AND "date" IN (${Prisma.join(nights)})
        AND "stopSell" = false
        AND ("totalAllocated" - "bookedCount" - "heldCount" - "blockedCount") >= ${rooms}
    `;
    if (Number(affected) !== nights.length) {
      throw new ConflictException(
        'This offer is no longer available. Please search again.',
      );
    }
    return true;
  }

  /** Cancellation-time release — always called for the booking's exact
   * original stay range, safe by construction per claimNights()'s comment.
   * Floors at 0 defensively rather than trusting bookedCount can never
   * undershoot. */
  async releaseNights(
    companyId: string,
    roomTypeId: string,
    checkInDate: string | Date,
    checkOutDate: string | Date,
    rooms: number,
  ): Promise<void> {
    const nights = nightsBetween(checkInDate, checkOutDate);
    if (nights.length === 0) return;
    await this.prisma.$executeRaw`
      UPDATE hotel_allotments
      SET "bookedCount" = GREATEST("bookedCount" - ${rooms}, 0), "updatedAt" = NOW()
      WHERE "companyId" = ${companyId}
        AND "roomTypeId" = ${roomTypeId}
        AND "date" IN (${Prisma.join(nights)})
    `;
  }

  /** Auto-release sweep (spec's "releasePeriodDays"-adjacent releaseDate
   * field) — once a row's releaseDate has passed without it already being
   * auto-released, stop further sales against it (the negotiated block is
   * assumed to have reverted to the supplier's general inventory). Never
   * touches bookedCount — rooms already booked through us stay booked;
   * this only prevents new claims. */
  @Cron(CronExpression.EVERY_HOUR)
  async runAutoReleaseSweep(): Promise<{ released: number }> {
    const result = await this.prisma.hotelAllotment.updateMany({
      where: {
        autoReleased: false,
        stopSell: false,
        releaseDate: { not: null, lte: new Date() },
      },
      data: { stopSell: true, autoReleased: true },
    });
    if (result.count > 0) {
      this.logger.log(
        `Auto-released ${result.count} hotel allotment row(s) past their release date`,
      );
    }
    return { released: result.count };
  }
}
