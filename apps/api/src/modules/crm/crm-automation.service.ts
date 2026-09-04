import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  InvoiceStatus,
  TicketStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from './tasks.service';

const REQUIRED_VISA_DOCUMENT_TYPES = ['PASSPORT', 'PHOTO'];
const PAYMENT_OVERDUE_AFTER_DAYS = 14;
const GUARANTOR_STALE_AFTER_DAYS = 3;
const DEPARTURE_WARNING_DAYS = 7;

/**
 * Spec #9's automatic task creation, plus spec #13's SLA-breach flag and
 * spec #25's escalation sweep — one daily cron alongside RemindersService's
 * existing one (same @nestjs/schedule mechanism, already registered
 * globally in app.module.ts), rather than a second scheduler.
 * TasksService.createAuto() is idempotent per relatedType/relatedId, so
 * running this sweep daily never piles up duplicate tasks for an issue
 * nobody has actioned yet.
 */
@Injectable()
export class CrmAutomationService {
  private readonly logger = new Logger(CrmAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runScheduled(): Promise<void> {
    this.logger.log('Running CRM automation sweep');
    const result = await this.runAll();
    this.logger.log(`CRM automation sweep complete: ${JSON.stringify(result)}`);
  }

  async runAll() {
    const [
      overdueTasksFlagged,
      visaDocumentTasks,
      paymentFollowUpTasks,
      guarantorTasks,
      departureTasks,
      slaBreaches,
      escalations,
    ] = await Promise.all([
      this.tasksService.flagOverdue(),
      this.createVisaMissingDocumentTasks(),
      this.createPaymentFollowUpTasks(),
      this.createGuarantorVerificationTasks(),
      this.createDepartureConfirmationTasks(),
      this.flagSlaBreaches(),
      this.runEscalations(),
    ]);
    return {
      overdueTasksFlagged,
      visaDocumentTasks,
      paymentFollowUpTasks,
      guarantorTasks,
      departureTasks,
      slaBreaches,
      escalations,
    };
  }

  /** Spec #9: "Visa missing document → create task for assigned visa officer." */
  private async createVisaMissingDocumentTasks(): Promise<number> {
    const applications = await this.prisma.visaApplication.findMany({
      where: {
        status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED'] },
        assignedStaffId: { not: null },
      },
      include: { documents: { select: { type: true } } },
    });

    let count = 0;
    for (const app of applications) {
      const uploadedTypes = new Set(app.documents.map((d) => d.type));
      const missing = REQUIRED_VISA_DOCUMENT_TYPES.filter(
        (t) => !uploadedTypes.has(t as never),
      );
      if (missing.length === 0 || !app.assignedStaffId) continue;

      await this.tasksService.createAuto({
        title: `Missing documents on visa application ${app.applicationReference}`,
        description: `Missing: ${missing.join(', ')}`,
        relatedType: 'VISA',
        relatedId: app.id,
        customerId: app.customerId,
        assignedStaffId: app.assignedStaffId,
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        priority: 'HIGH',
      });
      count++;
    }
    return count;
  }

  /** Spec #9: "Payment overdue → create follow-up task" — covers Hajj/Umrah installments too, since they're just another invoice. */
  private async createPaymentFollowUpTasks(): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      },
      include: {
        payments: true,
        customer: { select: { id: true, assignedStaffId: true } },
      },
    });

    let count = 0;
    const now = Date.now();
    for (const invoice of invoices) {
      if (!invoice.customer?.assignedStaffId) continue;
      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
      if (invoice.totalAmount - totalPaid <= 0) continue;
      const ageDays =
        (now - invoice.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays <= PAYMENT_OVERDUE_AFTER_DAYS) continue;

      await this.tasksService.createAuto({
        title: `Overdue payment follow-up: invoice ${invoice.invoiceNumber}`,
        description: `Outstanding balance of ${invoice.currency} ${invoice.totalAmount - totalPaid}`,
        relatedType: 'PAYMENT',
        relatedId: invoice.id,
        customerId: invoice.customer.id,
        assignedStaffId: invoice.customer.assignedStaffId,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'HIGH',
      });
      count++;
    }
    return count;
  }

  /** Spec #9: "Guarantor not verified → create task." */
  private async createGuarantorVerificationTasks(): Promise<number> {
    const cutoff = new Date(
      Date.now() - GUARANTOR_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const guarantors = await this.prisma.guarantor.findMany({
      where: {
        verificationStatus: VerificationStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      include: {
        application: {
          select: {
            id: true,
            applicationReference: true,
            customerId: true,
            assignedStaffId: true,
          },
        },
      },
    });

    let count = 0;
    for (const guarantor of guarantors) {
      if (!guarantor.application?.assignedStaffId) continue;
      await this.tasksService.createAuto({
        title: `Guarantor still unverified: ${guarantor.application.applicationReference}`,
        relatedType: 'GUARANTOR',
        relatedId: guarantor.id,
        customerId: guarantor.application.customerId,
        assignedStaffId: guarantor.application.assignedStaffId,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'NORMAL',
      });
      count++;
    }
    return count;
  }

  /** Spec #9: "Flight departure approaching → create customer confirmation task." */
  private async createDepartureConfirmationTasks(): Promise<number> {
    const soon = new Date(
      Date.now() + DEPARTURE_WARNING_DAYS * 24 * 60 * 60 * 1000,
    );
    const bookings = await this.prisma.flightBooking.findMany({
      where: {
        status: { in: ['CONFIRMED', 'TICKETED'] },
        departureAt: { gte: new Date(), lte: soon },
        bookedByStaffId: { not: null },
      },
    });

    let count = 0;
    for (const booking of bookings) {
      if (!booking.bookedByStaffId) continue;
      await this.tasksService.createAuto({
        title: `Confirm attendance: departure ${booking.bookingReference}`,
        description: `Departs ${booking.departureAt.toISOString().slice(0, 10)} — call the customer to confirm.`,
        relatedType: 'FLIGHT',
        relatedId: booking.id,
        customerId: booking.customerId,
        assignedStaffId: booking.bookedByStaffId,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'NORMAL',
      });
      count++;
    }
    return count;
  }

  /** Spec #13 — a ticket with no first staff response past its SLA deadline is breached. */
  private async flagSlaBreaches(): Promise<number> {
    const result = await this.prisma.supportTicket.updateMany({
      where: {
        firstRespondedAt: null,
        slaResponseDueAt: { lt: new Date() },
        slaBreached: false,
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      },
      data: { slaBreached: true },
    });
    return result.count;
  }

  /** Spec #25 — configurable, ordered escalation per priority; never re-notifies the same rule twice for the same ticket. */
  private async runEscalations(): Promise<number> {
    const rules = await this.prisma.escalationRule.findMany({
      where: { isActive: true },
    });
    if (rules.length === 0) return 0;

    const openTickets = await this.prisma.supportTicket.findMany({
      where: {
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      },
      include: { escalations: true },
    });

    let count = 0;
    for (const ticket of openTickets) {
      const ageMinutes = (Date.now() - ticket.createdAt.getTime()) / 60_000;
      const applicable = rules.filter(
        (r) => r.priority === ticket.priority && ageMinutes >= r.afterMinutes,
      );
      for (const rule of applicable) {
        const alreadyNotified = ticket.escalations.some(
          (e) => e.notifiedRole === rule.notifyRole,
        );
        if (alreadyNotified) continue;

        await this.notifyRole(
          rule.notifyRole,
          `Ticket escalation: ${ticket.ticketNumber}`,
          `Ticket ${ticket.ticketNumber} ("${ticket.subject}") has been unresolved for over ${rule.afterMinutes} minutes and needs attention.`,
        );
        await this.prisma.ticketEscalation.create({
          data: { ticketId: ticket.id, notifiedRole: rule.notifyRole },
        });
        count++;
      }
    }
    return count;
  }

  private async notifyRole(
    roleName: string,
    subject: string,
    body: string,
  ): Promise<void> {
    const identities = await this.prisma.identity.findMany({
      where: { roles: { some: { role: { name: roleName } } } },
      select: { id: true, email: true },
    });
    await Promise.all(
      identities.map((identity) =>
        this.notificationsService.sendGeneric(
          identity.email,
          identity.id,
          subject,
          body,
        ),
      ),
    );
  }
}
