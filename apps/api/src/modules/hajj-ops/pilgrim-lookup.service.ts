import { Injectable, NotFoundException } from '@nestjs/common';
import { PilgrimType, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const PILGRIM_INCLUDE = {
  customer: true,
  familyMember: true,
  registration: {
    include: { package: true, invoice: { include: { payments: true } } },
  },
  group: true,
} satisfies Prisma.HajjRegistrationPilgrimInclude &
  Prisma.UmrahRegistrationPilgrimInclude;

export type HajjPilgrimWithDetails = Prisma.HajjRegistrationPilgrimGetPayload<{
  include: typeof PILGRIM_INCLUDE;
}>;
export type UmrahPilgrimWithDetails =
  Prisma.UmrahRegistrationPilgrimGetPayload<{
    include: typeof PILGRIM_INCLUDE;
  }>;
export type PilgrimWithDetails =
  HajjPilgrimWithDetails | UmrahPilgrimWithDetails;

/**
 * Small shared helper so GroupsService/ReadinessService/CheckInService don't
 * each re-implement "which table is this pilgrim in" — a pilgrim is always a
 * HajjRegistrationPilgrim or UmrahRegistrationPilgrim row (see schema.prisma
 * Phase 8 header comment), addressed polymorphically by (pilgrimType, id).
 * Branches explicitly on `type` (rather than a dynamic `prisma[model]`
 * lookup) so every call site stays fully typed — no `any`.
 */
@Injectable()
export class PilgrimLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async getPilgrim(type: PilgrimType, id: string): Promise<PilgrimWithDetails> {
    const pilgrim =
      type === PilgrimType.HAJJ
        ? await this.prisma.hajjRegistrationPilgrim.findUnique({
            where: { id },
            include: PILGRIM_INCLUDE,
          })
        : await this.prisma.umrahRegistrationPilgrim.findUnique({
            where: { id },
            include: PILGRIM_INCLUDE,
          });
    if (!pilgrim) {
      throw new NotFoundException('Pilgrim not found');
    }
    return pilgrim;
  }

  /**
   * Spec #33: a short, random, internal-only identifier for QR check-in —
   * generated once on first read and persisted, never re-derived from
   * passport/financial data. Retries on the (astronomically unlikely)
   * unique-constraint collision.
   */
  async ensurePilgrimCode(type: PilgrimType, id: string): Promise<string> {
    const pilgrim = await this.getPilgrim(type, id);
    if (pilgrim.pilgrimCode) return pilgrim.pilgrimCode;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `PLG-${randomBytes(6).toString('hex').toUpperCase()}`;
      try {
        if (type === PilgrimType.HAJJ) {
          await this.prisma.hajjRegistrationPilgrim.update({
            where: { id },
            data: { pilgrimCode: code },
          });
        } else {
          await this.prisma.umrahRegistrationPilgrim.update({
            where: { id },
            data: { pilgrimCode: code },
          });
        }
        return code;
      } catch {
        // Unique collision — retry with a fresh random code.
      }
    }
    throw new Error('Could not generate a unique pilgrim code');
  }

  async findByCode(
    code: string,
  ): Promise<{ pilgrimType: PilgrimType; pilgrimId: string }> {
    const hajj = await this.prisma.hajjRegistrationPilgrim.findUnique({
      where: { pilgrimCode: code },
      select: { id: true },
    });
    if (hajj) return { pilgrimType: PilgrimType.HAJJ, pilgrimId: hajj.id };

    const umrah = await this.prisma.umrahRegistrationPilgrim.findUnique({
      where: { pilgrimCode: code },
      select: { id: true },
    });
    if (umrah) return { pilgrimType: PilgrimType.UMRAH, pilgrimId: umrah.id };

    throw new NotFoundException('No pilgrim found for this QR code');
  }
}
