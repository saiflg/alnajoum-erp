import { Injectable } from '@nestjs/common';
import { PilgrimCheckInEvent, PilgrimType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PilgrimLookupService } from './pilgrim-lookup.service';

// Spec #14's offline check-in outbox replays a queued scan once connectivity
// returns; if the original request actually landed but the client never saw
// the response (connection dropped right as it completed), the replay must
// not create a second PilgrimCheckIn row. A same (pilgrim, event) check-in
// within this window is treated as the same physical event, not a new one —
// no client-supplied idempotency key needed.
const DEDUPE_WINDOW_MINUTES = 5;

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

    const existing = await this.prisma.pilgrimCheckIn.findFirst({
      where: {
        pilgrimType,
        pilgrimId,
        event,
        createdAt: {
          gte: new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

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
