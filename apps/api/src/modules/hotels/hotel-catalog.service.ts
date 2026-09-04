import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateHotelRoomTypeDto } from './dto/create-hotel-room-type.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateHotelRoomTypeDto } from './dto/update-hotel-room-type.dto';

/**
 * Admin-facing catalog management (spec #1/#3) — the Hotel/HotelRoomType
 * tables CatalogHotelProviderService searches against. Margin is never
 * stored: HotelRoomType.sellingPrice - .supplierCost is computed by the
 * caller (this session's reports/frontend), same principle as
 * VisaService's margin.
 */
@Injectable()
export class HotelCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listHotels(filters: { city?: string; status?: string }) {
    return this.prisma.hotel.findMany({
      where: {
        city: filters.city
          ? { equals: filters.city, mode: 'insensitive' }
          : undefined,
        status: filters.status as never,
      },
      include: { roomTypes: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getHotel(id: string) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id },
      include: { roomTypes: true },
    });
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }
    return hotel;
  }

  async createHotel(dto: CreateHotelDto, actorIdentityId?: string) {
    const hotel = await this.prisma.hotel.create({ data: dto });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel.created',
      entityType: 'Hotel',
      entityId: hotel.id,
      metadata: { name: hotel.name, city: hotel.city },
    });
    return hotel;
  }

  async updateHotel(id: string, dto: UpdateHotelDto, actorIdentityId?: string) {
    await this.getHotel(id);
    const hotel = await this.prisma.hotel.update({ where: { id }, data: dto });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel.updated',
      entityType: 'Hotel',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return hotel;
  }

  async deleteHotel(id: string, actorIdentityId?: string) {
    await this.getHotel(id);
    await this.prisma.hotel.delete({ where: { id } });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel.deleted',
      entityType: 'Hotel',
      entityId: id,
    });
  }

  async createRoomType(
    hotelId: string,
    dto: CreateHotelRoomTypeDto,
    actorIdentityId?: string,
  ) {
    await this.getHotel(hotelId);
    const roomType = await this.prisma.hotelRoomType.create({
      data: { ...dto, hotelId },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel_room_type.created',
      entityType: 'HotelRoomType',
      entityId: roomType.id,
      metadata: {
        hotelId,
        name: roomType.name,
        supplierCost: roomType.supplierCost,
        sellingPrice: roomType.sellingPrice,
      },
    });
    return roomType;
  }

  async updateRoomType(
    id: string,
    dto: UpdateHotelRoomTypeDto,
    actorIdentityId?: string,
  ) {
    const existing = await this.prisma.hotelRoomType.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Room type not found');
    }
    const roomType = await this.prisma.hotelRoomType.update({
      where: { id },
      data: dto,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel_room_type.updated',
      entityType: 'HotelRoomType',
      entityId: id,
      metadata: {
        fields: Object.keys(dto),
        previousPrice: existing.sellingPrice,
        newPrice: roomType.sellingPrice,
      },
    });
    return roomType;
  }

  async deleteRoomType(id: string, actorIdentityId?: string) {
    const existing = await this.prisma.hotelRoomType.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Room type not found');
    }
    await this.prisma.hotelRoomType.delete({ where: { id } });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'hotel_room_type.deleted',
      entityType: 'HotelRoomType',
      entityId: id,
    });
  }
}
