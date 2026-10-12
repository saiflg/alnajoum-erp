import { Injectable, NotFoundException } from '@nestjs/common';
import { StaffCardSettings } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CARD_ASSET_NAMESPACE,
  normaliseCardImage,
  readCardImage,
  removeCardImage,
} from './staff-card-images';
import { UpdateCardSettingsDto } from './dto/staff-cards.dto';

/** Per-company card design and wording. Created on first use from the company's own name. */
@Injectable()
export class StaffCardSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string): Promise<StaffCardSettings> {
    const existing = await this.prisma.staffCardSettings.findUnique({
      where: { companyId },
    });
    if (existing) return existing;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, email: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return this.prisma.staffCardSettings.upsert({
      where: { companyId },
      create: {
        companyId,
        displayName: company.name,
        contactEmail: company.email,
      },
      update: {},
    });
  }

  async update(
    companyId: string,
    dto: UpdateCardSettingsDto,
    actorIdentityId: string,
  ): Promise<StaffCardSettings> {
    await this.get(companyId);
    const row = await this.prisma.staffCardSettings.update({
      where: { companyId },
      data: { ...dto, updatedByIdentityId: actorIdentityId },
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'staff_card.settings_updated',
      entityType: 'StaffCardSettings',
      entityId: row.id,
      metadata: { fields: Object.keys(dto) },
    });
    return row;
  }

  /** Replaces the logo or the signature with a verified, re-encoded image. */
  async setAsset(
    companyId: string,
    kind: 'logo' | 'signature',
    file: Express.Multer.File,
    actorIdentityId: string,
  ): Promise<StaffCardSettings> {
    const current = await this.get(companyId);
    const stored = await normaliseCardImage(file, CARD_ASSET_NAMESPACE, kind);
    const field = kind === 'logo' ? 'logoFilename' : 'signatureFilename';
    const previous = current[field];
    const row = await this.prisma.staffCardSettings.update({
      where: { companyId },
      data: { [field]: stored, updatedByIdentityId: actorIdentityId },
    });
    await removeCardImage(CARD_ASSET_NAMESPACE, previous);
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: `staff_card.${kind}_changed`,
      entityType: 'StaffCardSettings',
      entityId: row.id,
    });
    return row;
  }

  async removeAsset(
    companyId: string,
    kind: 'logo' | 'signature',
    actorIdentityId: string,
  ): Promise<StaffCardSettings> {
    const current = await this.get(companyId);
    const field = kind === 'logo' ? 'logoFilename' : 'signatureFilename';
    const row = await this.prisma.staffCardSettings.update({
      where: { companyId },
      data: { [field]: null, updatedByIdentityId: actorIdentityId },
    });
    await removeCardImage(CARD_ASSET_NAMESPACE, current[field]);
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: `staff_card.${kind}_removed`,
      entityType: 'StaffCardSettings',
      entityId: row.id,
    });
    return row;
  }

  async assetBuffer(
    companyId: string,
    kind: 'logo' | 'signature',
  ): Promise<Buffer | null> {
    const s = await this.get(companyId);
    return readCardImage(
      CARD_ASSET_NAMESPACE,
      kind === 'logo' ? s.logoFilename : s.signatureFilename,
    );
  }
}
