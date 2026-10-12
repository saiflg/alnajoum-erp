import { Injectable, NotFoundException } from '@nestjs/common';
import { CommSettings, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCommSettingsDto } from './dto/comm.dto';

export interface TopicOption {
  key: string;
  label: string;
}

export const DEFAULT_TOPICS: TopicOption[] = [
  { key: 'flight_deals', label: 'Flight offers' },
  { key: 'umrah', label: 'Umrah packages and announcements' },
  { key: 'hajj', label: 'Hajj updates' },
  { key: 'visa', label: 'Visa updates' },
  { key: 'hotel', label: 'Hotel offers' },
  { key: 'travel_tips', label: 'Travel tips and newsletters' },
];

/** The largest audience each role may send to on its own; a larger campaign needs a higher role to approve. */
export const DEFAULT_MAX_CAMPAIGN_SIZE: Record<string, number> = {
  SUPER_ADMIN: 50000,
  COMPANY_ADMIN: 10000,
  BRANCH_MANAGER: 1000,
  STAFF: 200,
};

/** Per-company Communication Centre settings. Created on first use with conservative defaults. */
@Injectable()
export class CommSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string): Promise<CommSettings> {
    const existing = await this.prisma.commSettings.findUnique({
      where: { companyId },
    });
    if (existing) return existing;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, email: true, timezone: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return this.prisma.commSettings.upsert({
      where: { companyId },
      create: {
        companyId,
        senderName: company.name,
        replyTo: company.email,
        businessTimezone: company.timezone || 'Africa/Lagos',
        maxCampaignSizeByRole: DEFAULT_MAX_CAMPAIGN_SIZE,
        topics: DEFAULT_TOPICS as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  topics(settings: CommSettings): TopicOption[] {
    const raw = settings.topics;
    if (!Array.isArray(raw)) return DEFAULT_TOPICS;
    return (raw as unknown[]).filter(
      (t): t is TopicOption =>
        !!t &&
        typeof (t as TopicOption).key === 'string' &&
        typeof (t as TopicOption).label === 'string',
    );
  }

  maxCampaignSize(settings: CommSettings, roles: string[]): number {
    const table =
      (settings.maxCampaignSizeByRole as Record<string, number> | null) ??
      DEFAULT_MAX_CAMPAIGN_SIZE;
    const sizes = roles
      .map((r) => table[r])
      .filter((n): n is number => typeof n === 'number');
    return sizes.length ? Math.max(...sizes) : 0;
  }

  async update(
    companyId: string,
    dto: UpdateCommSettingsDto,
    actorIdentityId: string,
  ): Promise<CommSettings> {
    const before = await this.get(companyId);
    const { topics, maxCampaignSizeByRole, ...rest } = dto;
    const data: Prisma.CommSettingsUpdateInput = {
      ...rest,
      updatedByIdentityId: actorIdentityId,
    };
    if (topics)
      data.topics = topics.map((t) => ({
        key: t.key,
        label: t.label,
      }));
    if (maxCampaignSizeByRole)
      data.maxCampaignSizeByRole = maxCampaignSizeByRole;
    // A new wording is a new version: consent already on file stays tied to the text the person actually saw.
    const wordingChanged =
      (dto.consentTextEmail !== undefined &&
        dto.consentTextEmail !== before.consentTextEmail) ||
      (dto.consentTextWhatsApp !== undefined &&
        dto.consentTextWhatsApp !== before.consentTextWhatsApp);
    if (wordingChanged && dto.consentTextVersion === undefined)
      data.consentTextVersion = String(
        Number(before.consentTextVersion) + 1 || Date.now(),
      );
    const row = await this.prisma.commSettings.update({
      where: { companyId },
      data,
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.settings_updated',
      entityType: 'CommSettings',
      entityId: row.id,
      metadata: { fields: Object.keys(dto) },
    });
    return row;
  }
}
