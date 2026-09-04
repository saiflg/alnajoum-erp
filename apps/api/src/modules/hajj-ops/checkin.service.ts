import { Injectable } from '@nestjs/common';
import { PilgrimCheckInEvent, PilgrimType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';

/**
 * Spec #33/#34 — QR generation + QR-based check-in. The QR payload is just
 * HajjRegistrationPilgrim/UmrahRegistrationPilgrim.pilgrimCode, an opaque
 * internal identifier (see PilgrimLookupService.ensurePilgrimCode) — it
 * never encodes passport, financial, or other sensitive data, so a lost or
 * photographed QR code reveals nothing on its own.
 */
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pilgrimLookup: PilgrimLookupService,
  ) {}

  async getOrCreateQrCode(type: PilgrimType, id: string) {
    const code = await this.pilgrimLookup.ensurePilgrimCode(type, id);
    return { pilgrimCode: code };
  }

  /** Check in by scanning a QR code (the pilgrim's opaque code). */
  async checkInByCode(
    code: string,
    event: PilgrimCheckInEvent,
    staffId?: string,
    location?: string,
  ) {
    const { pilgrimType, pilgrimId } =
      await this.pilgrimLookup.findByCode(code);
    return this.recordCheckIn(pilgrimType, pilgrimId, event, staffId, location);
  }

  async recordCheckIn(
    pilgrimType: PilgrimType,
    pilgrimId: string,
    event: PilgrimCheckInEvent,
    staffId?: string,
    location?: string,
  ) {
    await this.pilgrimLookup.getPilgrim(pilgrimType, pilgrimId); // 404s if unknown
    const checkIn = await this.prisma.pilgrimCheckIn.create({
      data: { pilgrimType, pilgrimId, event, staffId, location },
    });
    await this.auditService.record({
      action: 'pilgrim.checked_in',
      entityType:
        pilgrimType === PilgrimType.HAJJ
          ? 'HajjRegistrationPilgrim'
          : 'UmrahRegistrationPilgrim',
      entityId: pilgrimId,
      metadata: { event, location },
    });
    return checkIn;
  }

  history(pilgrimType: PilgrimType, pilgrimId: string) {
    return this.prisma.pilgrimCheckIn.findMany({
      where: { pilgrimType, pilgrimId },
      include: { staff: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
