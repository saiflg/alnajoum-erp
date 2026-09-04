import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer, LeadStatus, IdentityType } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SYSTEM_ROLES } from '../rbac/constants/default-roles.constant';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

/** Spec #5's default pipeline — seeded once, then fully admin-editable (see LeadStagesController). */
const DEFAULT_STAGES: {
  name: string;
  order: number;
  isWon?: boolean;
  isLost?: boolean;
}[] = [
  { name: 'New Lead', order: 1 },
  { name: 'Contacted', order: 2 },
  { name: 'Qualified', order: 3 },
  { name: 'Quotation Sent', order: 4 },
  { name: 'Negotiation', order: 5 },
  { name: 'Payment Pending', order: 6 },
  { name: 'Converted', order: 7, isWon: true },
  { name: 'Lost', order: 8, isLost: true },
];

function generateLeadNumber(): string {
  return `LEAD-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Idempotent — same pattern as LedgerService.ensureSystemAccounts(). */
  async ensureDefaultStages(): Promise<void> {
    for (const stage of DEFAULT_STAGES) {
      await this.prisma.leadStage.upsert({
        where: { name: stage.name },
        create: {
          name: stage.name,
          order: stage.order,
          isWon: stage.isWon ?? false,
          isLost: stage.isLost ?? false,
        },
        update: {},
      });
    }
  }

  private async defaultStage() {
    return this.prisma.leadStage.findFirstOrThrow({
      where: { isWon: false, isLost: false },
      orderBy: { order: 'asc' },
    });
  }

  async create(dto: CreateLeadDto, createdByStaffId?: string) {
    const stage = await this.defaultStage();
    const lead = await this.prisma.lead.create({
      data: {
        leadNumber: generateLeadNumber(),
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        source: dto.source,
        interestedService: dto.interestedService,
        destination: dto.destination,
        budget: dto.budget,
        priority: dto.priority,
        assignedStaffId: dto.assignedStaffId,
        assignedBranchId: dto.assignedBranchId,
        campaignId: dto.campaignId,
        notes: dto.notes,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        stageId: stage.id,
        createdByStaffId,
      },
    });

    await this.prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        action: 'created',
        description: `Lead created from ${dto.source.toLowerCase().replace('_', ' ')}`,
        performedByStaffId: createdByStaffId,
      },
    });

    await this.auditService.record({
      action: 'lead.created',
      entityType: 'Lead',
      entityId: lead.id,
      metadata: { source: dto.source, createdByStaffId },
    });

    return lead;
  }

  listAll(filters: {
    stageId?: string;
    status?: LeadStatus;
    assignedStaffId?: string;
    assignedBranchId?: string;
  }) {
    return this.prisma.lead.findMany({
      where: filters,
      include: {
        stage: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
        assignedBranch: { select: { name: true } },
        campaign: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        stage: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
        assignedBranch: { select: { name: true } },
        campaign: { select: { name: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedByStaff: { select: { firstName: true, lastName: true } },
          },
        },
        tasks: { orderBy: { dueDate: 'asc' } },
        convertedCustomer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    await this.get(id);
    return this.prisma.lead.update({
      where: { id },
      data: {
        ...dto,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
      },
    });
  }

  async changeStage(id: string, stageId: string, actorStaffId?: string) {
    const lead = await this.get(id);
    if (lead.status !== LeadStatus.OPEN) {
      throw new ConflictException('This lead is already converted or lost');
    }
    const stage = await this.prisma.leadStage.findUnique({
      where: { id: stageId },
    });
    if (!stage) {
      throw new NotFoundException('Lead stage not found');
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { stageId },
    });

    await this.prisma.leadActivity.create({
      data: {
        leadId: id,
        action: 'stage_changed',
        description: `Stage changed from ${lead.stage.name} to ${stage.name}`,
        fromStageId: lead.stageId,
        toStageId: stageId,
        performedByStaffId: actorStaffId,
      },
    });

    return updated;
  }

  /**
   * Manual assignment, plus spec #30's round-robin/workload methods —
   * mirrors Customer.assignedStaffId's existing manual-assignment shape,
   * just extended with two automatic strategies.
   */
  async assign(id: string, staffId: string, actorStaffId?: string) {
    await this.get(id);
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { assignedStaffId: staffId, assignedBranchId: staff.branchId },
    });

    await this.prisma.leadActivity.create({
      data: {
        leadId: id,
        action: 'assigned',
        description: `Assigned to ${staff.firstName} ${staff.lastName}`,
        performedByStaffId: actorStaffId,
      },
    });

    return updated;
  }

  /** Spec #30: round-robin across active staff in a branch (or company-wide if no branch given). */
  async assignRoundRobin(branchId?: string) {
    const candidates = await this.prisma.staff.findMany({
      where: { isActive: true, branchId: branchId ?? undefined },
      orderBy: { id: 'asc' },
    });
    if (candidates.length === 0) {
      throw new BadRequestException('No active staff available to assign to');
    }
    // Whoever was assigned the fewest OPEN leads most recently gets the next one.
    const counts = await this.prisma.lead.groupBy({
      by: ['assignedStaffId'],
      where: {
        status: LeadStatus.OPEN,
        assignedStaffId: { in: candidates.map((c) => c.id) },
      },
      _count: true,
    });
    const countMap = new Map(counts.map((c) => [c.assignedStaffId, c._count]));
    const next = candidates.reduce((lightest, candidate) =>
      (countMap.get(candidate.id) ?? 0) < (countMap.get(lightest.id) ?? 0)
        ? candidate
        : lightest,
    );
    return next.id;
  }

  async markLost(id: string, reason: string, actorStaffId?: string) {
    const lead = await this.get(id);
    if (lead.status !== LeadStatus.OPEN) {
      throw new ConflictException('This lead is already converted or lost');
    }
    const lostStage = await this.prisma.leadStage.findFirstOrThrow({
      where: { isLost: true },
    });

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.LOST,
        stageId: lostStage.id,
        lostReason: reason,
      },
    });

    await this.prisma.leadActivity.create({
      data: {
        leadId: id,
        action: 'lost',
        description: `Marked lost: ${reason}`,
        performedByStaffId: actorStaffId,
      },
    });

    return updated;
  }

  /**
   * Spec #6: converts a lead into a Customer, never creating a duplicate —
   * an existing customer matching the lead's phone/email is reused if one
   * is found (or explicitly passed via `existingCustomerId`), and only a
   * genuinely new person gets a new Identity/Customer row. `mode` only
   * affects the new Customer's customerType; corporate/family conversion
   * still reuses the exact same Customer model spec #1 (Family Management)
   * and #6 (Corporate Travel) already built — no parallel account type.
   */
  async convert(
    id: string,
    opts: {
      existingCustomerId?: string;
      mode?: 'CUSTOMER' | 'CORPORATE' | 'FAMILY';
      actorStaffId?: string;
    },
  ) {
    const lead = await this.get(id);
    if (lead.status !== LeadStatus.OPEN) {
      throw new ConflictException('This lead is already converted or lost');
    }

    let customer: Customer | null;
    if (opts.existingCustomerId) {
      customer = await this.prisma.customer.findUnique({
        where: { id: opts.existingCustomerId },
      });
      if (!customer) {
        throw new NotFoundException('Selected existing customer not found');
      }
    } else {
      customer = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { identity: { phone: lead.phone } },
            ...(lead.email ? [{ identity: { email: lead.email } }] : []),
          ],
        },
      });
    }

    let welcomeEmailSent = false;
    if (!customer) {
      const [firstName, ...rest] = lead.name.trim().split(/\s+/);
      const lastName = rest.join(' ') || firstName;
      const email =
        lead.email ?? `${lead.phone.replace(/\D/g, '')}@leads.alnajoum.travel`;

      const existingByEmail = await this.prisma.identity.findUnique({
        where: { email },
      });
      if (existingByEmail) {
        throw new ConflictException(
          'An account with this email already exists — pass existingCustomerId to link it instead',
        );
      }

      const customerRole = await this.prisma.role.findUnique({
        where: { name: SYSTEM_ROLES.CUSTOMER },
      });
      const tempPassword = randomBytes(9).toString('base64url');
      const passwordHash = await argon2.hash(tempPassword);

      const identity = await this.prisma.identity.create({
        data: {
          email,
          phone: lead.phone,
          passwordHash,
          type: IdentityType.CUSTOMER,
          customer: {
            create: {
              firstName,
              lastName,
              customerType:
                opts.mode === 'CORPORATE'
                  ? 'CORPORATE'
                  : opts.mode === 'FAMILY'
                    ? 'GROUP'
                    : 'INDIVIDUAL',
              assignedStaffId: lead.assignedStaffId,
              assignedBranchId: lead.assignedBranchId,
            },
          },
          ...(customerRole && {
            roles: { create: [{ roleId: customerRole.id }] },
          }),
        },
        include: { customer: true },
      });
      customer = identity.customer!;

      await this.notificationsService.sendGeneric(
        email,
        identity.id,
        'Welcome to Alnajoum Travel Agency',
        `Hi ${firstName},\n\nAn account has been created for you following up on your enquiry. Use "Forgot password" on the login page with this email to set your own password and access your customer portal.`,
      );
      welcomeEmailSent = true;
    }

    const wonStage = await this.prisma.leadStage.findFirstOrThrow({
      where: { isWon: true },
    });
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.CONVERTED,
        stageId: wonStage.id,
        convertedCustomerId: customer.id,
        convertedAt: new Date(),
      },
    });

    await this.prisma.leadActivity.create({
      data: {
        leadId: id,
        action: 'converted',
        description: welcomeEmailSent
          ? `Converted to a new customer account (${customer.id})`
          : `Converted, linked to existing customer (${customer.id})`,
        performedByStaffId: opts.actorStaffId,
      },
    });

    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId: customer.id,
        type: 'OTHER',
        description: `Converted from lead ${lead.leadNumber}`,
        relatedType: 'LEAD',
        relatedId: lead.id,
        createdByStaffId: opts.actorStaffId,
      },
    });

    await this.auditService.record({
      action: 'lead.converted',
      entityType: 'Lead',
      entityId: id,
      metadata: { customerId: customer.id, newAccount: welcomeEmailSent },
    });

    return { lead: updated, customer };
  }

  listStages() {
    return this.prisma.leadStage.findMany({ orderBy: { order: 'asc' } });
  }

  async createStage(name: string, order: number) {
    return this.prisma.leadStage.create({ data: { name, order } });
  }
}
