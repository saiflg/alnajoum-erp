import { BadRequestException, Injectable } from '@nestjs/common';
import { AiMemoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { maskDeep } from '../runtime/guards';

interface Rule {
  subjects: string[];
  keys: string[];
  ttlDays: number;
}

/**
 * What an agent may remember, in code. A key not on the list for its type is refused, so an agent (or a
 * message telling it to "remember my password") cannot store arbitrary sensitive data. Everything is
 * tenant-scoped, expires, can be deleted per subject, and is wiped when a customer is erased.
 */
export const MEMORY_RULES: Partial<Record<AiMemoryType, Rule>> = {
  SHORT_TERM: {
    subjects: ['CONVERSATION'],
    keys: ['pendingOffer', 'pendingRequest', 'lastIntent', 'slots', 'awaiting'],
    ttlDays: 1,
  },
  OPERATIONAL: {
    subjects: ['BOOKING', 'APPLICATION', 'GROUP'],
    keys: ['context', 'lastCheck', 'openIssue'],
    ttlDays: 14,
  },
  PREFERENCE: {
    subjects: ['CUSTOMER'],
    keys: [
      'personalization',
      'preferredAirline',
      'preferredCabin',
      'preferredHotelCategory',
      'preferredTravelMonth',
      'preferredLanguage',
    ],
    ttlDays: 365,
  },
  HISTORICAL: {
    subjects: ['CUSTOMER'],
    keys: ['interactionSummary'],
    ttlDays: 180,
  },
};

const MAX_VALUE_BYTES = 2048;

@Injectable()
export class AiMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async write(args: {
    companyId: string;
    type: AiMemoryType;
    subjectType: string;
    subjectId: string;
    key: string;
    value: unknown;
    source: string;
    confidence?: string;
  }) {
    const rule = MEMORY_RULES[args.type];
    if (!rule)
      throw new BadRequestException(
        `${args.type} memory is not writable by agents`,
      );
    if (!rule.subjects.includes(args.subjectType))
      throw new BadRequestException(
        `${args.type} memory cannot be about a ${args.subjectType}`,
      );
    if (!rule.keys.includes(args.key))
      throw new BadRequestException(
        `"${args.key}" is not something an agent may remember`,
      );

    if (args.type === 'PREFERENCE' && args.key !== 'personalization') {
      const consent = await this.read(
        args.companyId,
        'PREFERENCE',
        'CUSTOMER',
        args.subjectId,
        'personalization',
      );
      if (
        (consent?.value as { enabled?: boolean } | undefined)?.enabled === false
      )
        throw new BadRequestException(
          'This customer has switched personalisation off',
        );
    }

    const value = maskDeep(args.value) as Prisma.InputJsonValue;
    if (Buffer.byteLength(JSON.stringify(value ?? null)) > MAX_VALUE_BYTES)
      throw new BadRequestException('That is too much to remember');
    const expiresAt = new Date(Date.now() + rule.ttlDays * 86_400_000);
    return this.prisma.aiMemory.upsert({
      where: {
        companyId_type_subjectType_subjectId_key: {
          companyId: args.companyId,
          type: args.type,
          subjectType: args.subjectType,
          subjectId: args.subjectId,
          key: args.key,
        },
      },
      update: {
        value,
        source: args.source,
        confidence: args.confidence,
        expiresAt,
        deletedAt: null,
      },
      create: {
        companyId: args.companyId,
        type: args.type,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        key: args.key,
        value,
        source: args.source,
        confidence: args.confidence,
        expiresAt,
      },
    });
  }

  async read(
    companyId: string,
    type: AiMemoryType,
    subjectType: string,
    subjectId: string,
    key: string,
  ) {
    const row = await this.prisma.aiMemory.findUnique({
      where: {
        companyId_type_subjectType_subjectId_key: {
          companyId,
          type,
          subjectType,
          subjectId,
          key,
        },
      },
    });
    if (!row || row.deletedAt || (row.expiresAt && row.expiresAt < new Date()))
      return null;
    return row;
  }

  async deleteKey(
    companyId: string,
    type: AiMemoryType,
    subjectType: string,
    subjectId: string,
    key: string,
  ) {
    await this.prisma.aiMemory.deleteMany({
      where: { companyId, type, subjectType, subjectId, key },
    });
  }

  async forSubject(companyId: string, subjectType: string, subjectId: string) {
    return this.prisma.aiMemory.findMany({
      where: {
        companyId,
        subjectType,
        subjectId,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Customer or staff asked to forget: hard delete (not a flag), because retention is the point. */
  async deleteForSubject(
    companyId: string,
    subjectType: string,
    subjectId: string,
  ) {
    const r = await this.prisma.aiMemory.deleteMany({
      where: { companyId, subjectType, subjectId },
    });
    return { removed: r.count };
  }

  async deleteOne(companyId: string, id: string) {
    const r = await this.prisma.aiMemory.deleteMany({
      where: { id, companyId },
    });
    return { removed: r.count };
  }

  /** The retention sweep: expired memory is deleted, not kept. */
  async purgeExpired(now = new Date()) {
    const r = await this.prisma.aiMemory.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { deletedAt: { not: null } }] },
    });
    return { removed: r.count };
  }
}
