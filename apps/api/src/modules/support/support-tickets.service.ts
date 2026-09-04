import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TicketMessageAuthorType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { SupportConfigService } from './support-config.service';

function generateTicketNumber(): string {
  return `TKT-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Spec #10-#14. A ticket's message thread (SupportTicketMessage) is also
 * the live-chat transport (spec #14) — see its doc comment in
 * schema.prisma. `sanitizeForCustomer` is what spec #12's "prevent
 * accidental disclosure of internal notes" means in code: every
 * customer-facing read filters isInternal messages server-side, never
 * relying on the client to hide them.
 */
@Injectable()
export class SupportTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: SupportConfigService,
  ) {}

  async create(customerId: string, dto: CreateTicketDto) {
    const priority = dto.priority ?? TicketPriority.NORMAL;
    const responseMinutes =
      await this.configService.responseMinutesFor(priority);
    const slaResponseDueAt = new Date(Date.now() + responseMinutes * 60_000);

    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        customerId,
        subject: dto.subject,
        categoryId: dto.categoryId,
        priority,
        description: dto.description,
        status: TicketStatus.OPEN,
        slaResponseDueAt,
        messages: {
          create: {
            authorType: TicketMessageAuthorType.CUSTOMER,
            message: dto.description,
          },
        },
      },
      include: { category: true },
    });

    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId,
        type: 'SUPPORT_TICKET_CREATED',
        description: `Support ticket ${ticket.ticketNumber} opened: ${dto.subject}`,
        relatedType: 'SUPPORT_TICKET',
        relatedId: ticket.id,
      },
    });

    await this.auditService.record({
      action: 'support_ticket.created',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      metadata: { customerId, priority },
    });

    return ticket;
  }

  private sanitizeMessages<T extends { isInternal: boolean }>(
    messages: T[],
  ): T[] {
    return messages.filter((m) => !m.isInternal);
  }

  listForCustomer(customerId: string) {
    return this.prisma.supportTicket.findMany({
      where: { customerId },
      include: {
        category: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForCustomer(id: string, customerId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        category: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket || ticket.customerId !== customerId) {
      throw new NotFoundException('Support ticket not found');
    }
    return { ...ticket, messages: this.sanitizeMessages(ticket.messages) };
  }

  listAll(filters: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignedStaffId?: string;
    branchId?: string;
    categoryId?: string;
  }) {
    return this.prisma.supportTicket.findMany({
      where: filters,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        category: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        category: true,
        assignedStaff: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            authorStaff: { select: { firstName: true, lastName: true } },
          },
        },
        escalations: { orderBy: { triggeredAt: 'desc' } },
      },
    });
    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }
    return ticket;
  }

  async assign(id: string, staffId: string, branchId?: string) {
    await this.get(id);
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        assignedStaffId: staffId,
        branchId,
        status: TicketStatus.ASSIGNED,
      },
    });
  }

  async updateStatus(id: string, status: TicketStatus) {
    const ticket = await this.get(id);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new ForbiddenException('This ticket is closed');
    }
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        status,
        resolvedAt:
          status === TicketStatus.RESOLVED ? new Date() : ticket.resolvedAt,
        closedAt: status === TicketStatus.CLOSED ? new Date() : ticket.closedAt,
      },
    });
  }

  /**
   * `isInternal` is only ever true for a staff author — the customer-facing
   * controller never passes it through, so a customer physically cannot
   * create an internal note (spec #12).
   */
  async addMessage(
    id: string,
    message: string,
    authorType: TicketMessageAuthorType,
    authorStaffId?: string,
    isInternal = false,
  ) {
    const ticket = await this.get(id);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new ForbiddenException('This ticket is closed');
    }

    const created = await this.prisma.supportTicketMessage.create({
      data: { ticketId: id, authorType, authorStaffId, message, isInternal },
    });

    const isFirstStaffResponse =
      authorType === TicketMessageAuthorType.STAFF &&
      !isInternal &&
      !ticket.firstRespondedAt;

    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        firstRespondedAt: isFirstStaffResponse ? new Date() : undefined,
        status:
          authorType === TicketMessageAuthorType.STAFF && !isInternal
            ? TicketStatus.WAITING_FOR_CUSTOMER
            : authorType === TicketMessageAuthorType.CUSTOMER
              ? TicketStatus.WAITING_FOR_STAFF
              : ticket.status,
      },
    });

    if (authorType === TicketMessageAuthorType.STAFF && !isInternal) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: ticket.customerId },
        include: { identity: { select: { email: true, id: true } } },
      });
      if (customer) {
        await this.notificationsService.sendGeneric(
          customer.identity.email,
          customer.identity.id,
          `Update on your support ticket ${ticket.ticketNumber}`,
          message,
        );
      }
    }

    return created;
  }

  async resolve(id: string) {
    const updated = await this.updateStatus(id, TicketStatus.RESOLVED);
    const ticket = await this.get(id);
    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId: ticket.customerId,
        type: 'SUPPORT_TICKET_RESOLVED',
        description: `Support ticket ${ticket.ticketNumber} resolved`,
        relatedType: 'SUPPORT_TICKET',
        relatedId: id,
      },
    });
    return updated;
  }
}
