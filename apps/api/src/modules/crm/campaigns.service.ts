import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Spec #28 — leads generated tracked via Lead.campaignId (set at creation, see LeadsController.create). */
@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: {
    name: string;
    description?: string;
    targetService: string;
    targetAudience?: string;
    startDate: string;
    endDate?: string;
    budget?: number;
    channel?: string;
    createdByStaffId?: string;
  }) {
    return this.prisma.campaign.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  listAll(filters: { status?: CampaignStatus }) {
    return this.prisma.campaign.findMany({
      where: filters,
      include: { _count: { select: { leads: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  async get(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        leads: {
          select: {
            id: true,
            leadNumber: true,
            name: true,
            status: true,
            stage: { select: { name: true } },
          },
        },
      },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const converted = campaign.leads.filter(
      (l) => l.status === 'CONVERTED',
    ).length;
    return {
      ...campaign,
      performance: { leadsGenerated: campaign.leads.length, converted },
    };
  }

  async updateStatus(id: string, status: CampaignStatus) {
    await this.get(id);
    return this.prisma.campaign.update({ where: { id }, data: { status } });
  }
}
