import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransportStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateTransportDto } from './dto/transport.dto';

/** Spec #13 — airport transfer / Makkah / Madinah / intercity / group bus / private vehicle scheduling. */
@Injectable()
export class TransportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTransportDto) {
    if (!dto.hajjGroupId && !dto.umrahGroupId) {
      throw new BadRequestException(
        'A transport assignment must reference either a Hajj group or an Umrah group',
      );
    }
    if (dto.hajjGroupId && dto.umrahGroupId) {
      throw new BadRequestException(
        'A transport assignment cannot reference both a Hajj group and an Umrah group',
      );
    }
    return this.prisma.transport.create({
      data: {
        type: dto.type,
        hajjGroupId: dto.hajjGroupId,
        umrahGroupId: dto.umrahGroupId,
        vehicleId: dto.vehicleId,
        driverId: dto.driverId,
        pickupLocation: dto.pickupLocation,
        dropoffLocation: dto.dropoffLocation,
        scheduledAt: new Date(dto.scheduledAt),
        notes: dto.notes,
      },
    });
  }

  listAll(filters: {
    hajjGroupId?: string;
    umrahGroupId?: string;
    status?: TransportStatus;
  }) {
    return this.prisma.transport.findMany({
      where: filters,
      include: {
        vehicle: { select: { plateNumber: true, type: true } },
        driver: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async get(id: string) {
    const transport = await this.prisma.transport.findUnique({
      where: { id },
      include: {
        vehicle: true,
        driver: true,
        hajjGroup: true,
        umrahGroup: true,
      },
    });
    if (!transport)
      throw new NotFoundException('Transport assignment not found');
    return transport;
  }

  async updateStatus(id: string, status: TransportStatus) {
    await this.get(id);
    return this.prisma.transport.update({ where: { id }, data: { status } });
  }
}
