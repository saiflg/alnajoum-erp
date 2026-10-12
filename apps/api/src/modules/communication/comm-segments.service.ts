import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommChannel, CommSegment, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExclusionReason, marketingEligibility } from './comm-consent.policy';
import { CommConsentService } from './comm-consent.service';
import {
  buildContactWhere,
  PRESET_SEGMENTS,
  SegmentDefinition,
  validateDefinition,
} from './comm-segment.definition';

export const AUDIENCE_LIMIT = 100_000;

export interface AudienceResult {
  /** Contacts matching the filter (before any consent rule). */
  total: number;
  /** Contacts that may receive marketing on this channel and topic right now. */
  eligible: number;
  excluded: number;
  breakdown: Partial<Record<ExclusionReason, number>>;
  /** Only filled when asked for: the eligible contact ids, in a stable order. */
  eligibleIds?: string[];
}

@Injectable()
export class CommSegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly consent: CommConsentService,
  ) {}

  // ---------------------------------------------------------------------------------------------- audience

  /** The contact filter that a stored segment stands for. */
  whereForSegment(segment: CommSegment): Prisma.CommContactWhereInput {
    if (segment.kind === 'STATIC')
      return {
        AND: [
          { companyId: segment.companyId, status: 'ACTIVE' },
          { segmentLinks: { some: { segmentId: segment.id } } },
        ],
      };
    return buildContactWhere(
      segment.companyId,
      validateDefinition(segment.definition),
    );
  }

  /**
   * Counts who in a group may be messaged on a channel and topic RIGHT NOW, and why each of the others may not.
   * This is the same rule the sender applies at the moment of sending; a preview can only be as permissive as it.
   */
  async evaluate(
    companyId: string,
    where: Prisma.CommContactWhereInput,
    channel: CommChannel,
    topic: string,
    opts: { collect?: boolean } = {},
  ): Promise<AudienceResult> {
    const type = channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
    const breakdown: Partial<Record<ExclusionReason, number>> = {};
    const eligibleIds: string[] = [];
    let total = 0;
    let eligible = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.commContact.findMany({
        where,
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          status: true,
          channels: {
            where: { type },
            select: { value: true, invalid: true, isPrimary: true },
          },
          subscriptions: {
            where: { channel },
            select: { status: true, topics: true },
          },
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      total += batch.length;
      if (total > AUDIENCE_LIMIT)
        throw new BadRequestException(
          `This group has more than ${AUDIENCE_LIMIT} contacts. Narrow it down.`,
        );

      const hashes = new Map<string, string>();
      for (const c of batch)
        for (const ch of c.channels)
          hashes.set(ch.value, this.consent.hashAddress(channel, ch.value));
      const suppressed = new Set(
        (
          await this.prisma.commSuppression.findMany({
            where: {
              companyId,
              channel,
              liftedAt: null,
              valueHash: { in: [...hashes.values()] },
            },
            select: { valueHash: true },
          })
        ).map((s) => s.valueHash),
      );

      for (const c of batch) {
        const address =
          c.channels.find((x) => x.isPrimary) ?? c.channels[0] ?? null;
        const sub = c.subscriptions[0];
        const verdict = marketingEligibility({
          contactStatus: c.status,
          hasAddress: !!address,
          addressInvalid: !!address?.invalid,
          suppressed: c.channels.some((x) =>
            suppressed.has(hashes.get(x.value) ?? ''),
          ),
          subscription: sub?.status ?? 'NONE',
          subscribedTopics: sub?.topics ?? [],
          topic,
        });
        if (verdict.eligible) {
          eligible++;
          if (opts.collect) eligibleIds.push(c.id);
        } else {
          breakdown[verdict.reason] = (breakdown[verdict.reason] ?? 0) + 1;
        }
      }
    }
    return {
      total,
      eligible,
      excluded: total - eligible,
      breakdown,
      ...(opts.collect ? { eligibleIds } : {}),
    };
  }

  /** Preview of a definition that has not been saved. Counts only, never a contact list. */
  async preview(
    companyId: string,
    rawDefinition: unknown,
    channel: CommChannel,
    topic = 'general',
  ) {
    const def = validateDefinition(rawDefinition);
    const result = await this.evaluate(
      companyId,
      buildContactWhere(companyId, def),
      channel,
      topic,
    );
    return { definition: def, channel, topic, ...result };
  }

  // ---------------------------------------------------------------------------------------------- CRUD

  /** Creates the starter segments once. Safe to call every time: existing names are left as they are. */
  async ensurePresets(companyId: string): Promise<void> {
    const count = await this.prisma.commSegment.count({ where: { companyId } });
    if (count > 0) return;
    await this.prisma.commSegment.createMany({
      data: PRESET_SEGMENTS.map((p) => ({
        companyId,
        name: p.name,
        description: p.description,
        kind: 'DYNAMIC' as const,
        definition: p.definition as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  async list(companyId: string, withCounts: boolean) {
    await this.ensurePresets(companyId);
    const rows = await this.prisma.commSegment.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      take: 100,
    });
    if (!withCounts) return rows.map((r) => ({ ...r, memberCount: null }));
    const out: (CommSegment & { memberCount: number })[] = [];
    for (const r of rows)
      out.push({
        ...r,
        memberCount: await this.prisma.commContact.count({
          where: this.whereForSegment(r),
        }),
      });
    return out;
  }

  async get(companyId: string | undefined, id: string): Promise<CommSegment> {
    const s = await this.prisma.commSegment.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
    });
    if (!s) throw new NotFoundException('Segment not found');
    return s;
  }

  async create(
    companyId: string,
    dto: {
      name: string;
      description?: string;
      kind?: 'DYNAMIC' | 'STATIC';
      definition?: unknown;
    },
    actorIdentityId: string,
  ) {
    const kind = dto.kind ?? 'DYNAMIC';
    const definition =
      kind === 'STATIC' ? {} : validateDefinition(dto.definition ?? {});
    try {
      const row = await this.prisma.commSegment.create({
        data: {
          companyId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          kind,
          definition: definition as unknown as Prisma.InputJsonValue,
          createdByIdentityId: actorIdentityId,
        },
      });
      await this.audit.record({
        identityId: actorIdentityId,
        companyId,
        action: 'comm.segment_created',
        entityType: 'CommSegment',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A segment with this name already exists.');
      throw e;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: { name?: string; description?: string; definition?: unknown },
    actorIdentityId: string,
  ) {
    const current = await this.get(companyId, id);
    const data: Prisma.CommSegmentUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    if (dto.definition !== undefined) {
      if (current.kind === 'STATIC')
        throw new BadRequestException('A fixed list has no filter to edit.');
      data.definition = validateDefinition(
        dto.definition,
      ) as unknown as Prisma.InputJsonValue;
    }
    try {
      const row = await this.prisma.commSegment.update({ where: { id }, data });
      await this.audit.record({
        identityId: actorIdentityId,
        companyId,
        action: 'comm.segment_updated',
        entityType: 'CommSegment',
        entityId: id,
        metadata: { fields: Object.keys(dto) },
      });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A segment with this name already exists.');
      throw e;
    }
  }

  async remove(companyId: string, id: string, actorIdentityId: string) {
    await this.get(companyId, id);
    const live = await this.prisma.commCampaign.count({
      where: {
        segmentId: id,
        status: {
          in: [
            'PENDING_APPROVAL',
            'APPROVED',
            'SCHEDULED',
            'SENDING',
            'PAUSED',
          ],
        },
      },
    });
    if (live > 0)
      throw new ConflictException(
        'A campaign that has not finished uses this segment. Cancel or finish it first.',
      );
    await this.prisma.commSegment.delete({ where: { id } });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.segment_deleted',
      entityType: 'CommSegment',
      entityId: id,
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------------------------- fixed lists

  async addMembers(
    companyId: string,
    id: string,
    contactIds: string[],
    actorIdentityId: string,
  ) {
    const seg = await this.get(companyId, id);
    if (seg.kind !== 'STATIC')
      throw new BadRequestException(
        'Only a fixed list has members added by hand.',
      );
    const valid = await this.prisma.commContact.findMany({
      where: { companyId, id: { in: contactIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    await this.prisma.commSegmentMember.createMany({
      data: valid.map((c) => ({ segmentId: id, contactId: c.id })),
      skipDuplicates: true,
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.segment_members_added',
      entityType: 'CommSegment',
      entityId: id,
      metadata: { added: valid.length },
    });
    return { added: valid.length };
  }

  async removeMembers(
    companyId: string,
    id: string,
    contactIds: string[],
    actorIdentityId: string,
  ) {
    const seg = await this.get(companyId, id);
    if (seg.kind !== 'STATIC')
      throw new BadRequestException(
        'Only a fixed list has members removed by hand.',
      );
    const r = await this.prisma.commSegmentMember.deleteMany({
      where: { segmentId: id, contactId: { in: contactIds } },
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.segment_members_removed',
      entityType: 'CommSegment',
      entityId: id,
      metadata: { removed: r.count },
    });
    return { removed: r.count };
  }

  /** Counts for one stored segment on a channel/topic: who is in it and who may be messaged. */
  async audienceFor(
    companyId: string,
    segmentId: string,
    channel: CommChannel,
    topic = 'general',
    collect = false,
  ) {
    const seg = await this.get(companyId, segmentId);
    return this.evaluate(companyId, this.whereForSegment(seg), channel, topic, {
      collect,
    });
  }

  definitionOf(segment: CommSegment): SegmentDefinition {
    return segment.kind === 'STATIC'
      ? {}
      : validateDefinition(segment.definition);
  }
}
