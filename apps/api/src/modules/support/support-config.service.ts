import { Injectable } from '@nestjs/common';
import { TicketPriority } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Spec #13's example thresholds — the seeded defaults; fully admin-editable afterward via SlaRule rows. */
const DEFAULT_SLA_MINUTES: Record<TicketPriority, number> = {
  CRITICAL: 60,
  HIGH: 240,
  NORMAL: 1440,
  LOW: 2880,
};

const DEFAULT_CATEGORIES = [
  'Flight',
  'Visa',
  'Hajj',
  'Umrah',
  'Hotel',
  'Payment',
  'Wallet',
  'Refund',
  'Booking',
  'Technical Support',
  'General Inquiry',
];

/** Spec #11 (categories) + #13 (SLA) admin configuration — seeded idempotently, then fully editable. */
@Injectable()
export class SupportConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults(): Promise<void> {
    for (const name of DEFAULT_CATEGORIES) {
      await this.prisma.supportTicketCategory.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    }
    for (const [priority, responseMinutes] of Object.entries(
      DEFAULT_SLA_MINUTES,
    )) {
      await this.prisma.slaRule.upsert({
        where: { priority: priority as TicketPriority },
        create: { priority: priority as TicketPriority, responseMinutes },
        update: {},
      });
    }
  }

  listCategories() {
    return this.prisma.supportTicketCategory.findMany({
      orderBy: { name: 'asc' },
    });
  }

  createCategory(name: string) {
    return this.prisma.supportTicketCategory.create({ data: { name } });
  }

  listSlaRules() {
    return this.prisma.slaRule.findMany({ orderBy: { priority: 'asc' } });
  }

  async updateSlaRule(priority: TicketPriority, responseMinutes: number) {
    return this.prisma.slaRule.upsert({
      where: { priority },
      create: { priority, responseMinutes },
      update: { responseMinutes },
    });
  }

  async responseMinutesFor(priority: TicketPriority): Promise<number> {
    const rule = await this.prisma.slaRule.findUnique({ where: { priority } });
    return rule?.responseMinutes ?? DEFAULT_SLA_MINUTES[priority];
  }

  listEscalationRules() {
    return this.prisma.escalationRule.findMany({
      orderBy: [{ priority: 'asc' }, { order: 'asc' }],
    });
  }

  createEscalationRule(data: {
    priority: TicketPriority;
    afterMinutes: number;
    notifyRole: string;
    order: number;
  }) {
    return this.prisma.escalationRule.create({ data });
  }
}
