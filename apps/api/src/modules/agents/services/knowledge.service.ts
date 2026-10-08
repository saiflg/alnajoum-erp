import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { maskSensitive } from '../runtime/guards';

export const KNOWLEDGE_CATEGORIES = [
  'COMPANY_POLICY',
  'TRAVEL_POLICY',
  'VISA',
  'HAJJ',
  'UMRAH',
  'PAYMENT',
  'REFUND',
  'SUPPORT',
  'SUPPLIER',
  'SOP',
] as const;

export interface KnowledgeHit {
  id: string;
  title: string;
  category: string;
  version: number;
  sourceLabel: string;
  excerpt: string;
  scope: 'BRANCH' | 'COMPANY' | 'PLATFORM';
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'what',
  'how',
  'do',
  'i',
  'my',
  'to',
  'of',
  'and',
  'or',
  'for',
  'in',
  'on',
  'can',
  'me',
  'you',
  'your',
  'we',
  'our',
  'it',
  'this',
  'that',
  'with',
  'be',
  'by',
  'at',
  'from',
  'about',
  'please',
]);

/**
 * Controlled company knowledge: versioned, with effective dates, tenant- and branch-specific. Retrieval returns
 * only PUBLISHED, currently-effective entries, most specific first (branch → company → platform), each carrying
 * the label a citation shows. An answer built from it cites the entry; nothing is invented to fill a gap.
 */
@Injectable()
export class AiKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: {
      companyId: string | null;
      branchId?: string | null;
      category: string;
      title: string;
      content: string;
      sourceLabel?: string;
      effectiveFrom?: Date;
      effectiveTo?: Date | null;
      status?: 'DRAFT' | 'PUBLISHED';
    },
    actor: { identityId: string },
  ) {
    if (!(KNOWLEDGE_CATEGORIES as readonly string[]).includes(input.category))
      throw new BadRequestException('Unknown knowledge category');
    // Knowledge is shown to customers: never store credentials in it.
    const content = maskSensitive(input.content);
    const previous = await this.prisma.aiKnowledgeSource.findFirst({
      where: {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        category: input.category,
        title: input.title,
      },
      orderBy: { version: 'desc' },
    });
    const version = (previous?.version ?? 0) + 1;
    const row = await this.prisma.aiKnowledgeSource.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        category: input.category,
        title: input.title,
        content,
        version,
        sourceLabel: input.sourceLabel ?? `${input.title} v${version}`,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        effectiveTo: input.effectiveTo ?? null,
        status: input.status ?? 'PUBLISHED',
        createdByIdentityId: actor.identityId,
      },
    });
    // A new published version retires the previous one for the same title (history is kept).
    if (previous && row.status === 'PUBLISHED') {
      await this.prisma.aiKnowledgeSource.updateMany({
        where: { id: previous.id, status: 'PUBLISHED' },
        data: { status: 'RETIRED', effectiveTo: new Date() },
      });
    }
    await this.audit.record({
      identityId: actor.identityId,
      companyId: input.companyId ?? undefined,
      action: 'ai.knowledge_saved',
      entityType: 'AiKnowledgeSource',
      entityId: row.id,
      metadata: { category: input.category, version },
    });
    return row;
  }

  list(companyId: string | null) {
    return this.prisma.aiKnowledgeSource.findMany({
      where: {
        OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])],
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }, { version: 'desc' }],
      take: 300,
    });
  }

  async retire(
    id: string,
    companyId: string | null,
    actor: { identityId: string },
  ) {
    const row = await this.prisma.aiKnowledgeSource.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
    });
    if (!row) throw new NotFoundException('Knowledge entry not found');
    await this.prisma.aiKnowledgeSource.update({
      where: { id },
      data: { status: 'RETIRED', effectiveTo: new Date() },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: row.companyId ?? undefined,
      action: 'ai.knowledge_retired',
      entityType: 'AiKnowledgeSource',
      entityId: id,
    });
    return { retired: true };
  }

  async search(
    query: string,
    ctx: { companyId: string | null; branchId: string | null },
    category?: string,
    now = new Date(),
  ): Promise<KnowledgeHit[]> {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2 && !STOP.has(t));
    const rows = await this.prisma.aiKnowledgeSource.findMany({
      where: {
        status: 'PUBLISHED',
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          {
            OR: [
              { companyId: null },
              ...(ctx.companyId ? [{ companyId: ctx.companyId }] : []),
            ],
          },
          {
            OR: [
              { branchId: null },
              ...(ctx.branchId ? [{ branchId: ctx.branchId }] : []),
            ],
          },
        ],
        ...(category ? { category } : {}),
      },
      take: 200,
    });
    const scoped = rows.map((r) => {
      const scope: KnowledgeHit['scope'] = r.branchId
        ? 'BRANCH'
        : r.companyId
          ? 'COMPANY'
          : 'PLATFORM';
      const hay = `${r.title} ${r.content}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      const rank =
        (scope === 'BRANCH' ? 2 : scope === 'COMPANY' ? 1 : 0) * 0.5 + hits;
      return { r, scope, hits, rank };
    });
    return scoped
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 3)
      .map(({ r, scope }) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        version: r.version,
        sourceLabel: r.sourceLabel,
        scope,
        excerpt:
          r.content.length > 600 ? `${r.content.slice(0, 600)}…` : r.content,
      }));
  }
}
