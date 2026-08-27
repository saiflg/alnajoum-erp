import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const OVERDUE_AFTER_DAYS = 14;
const REQUIRED_DOCUMENT_TYPES = ['PASSPORT', 'PHOTO'] as const;

/**
 * On-demand reminder sweep, triggered from the admin/finance dashboard
 * (`POST /reminders/run`, permission REMINDER.RUN) rather than a background
 * cron — this project has no task-scheduler infrastructure yet (see
 * README's Remaining tasks), so a real deployment would wire this same
 * `runAll()` method behind a scheduled job (cron, a queue worker, etc.)
 * instead of a manual trigger. The logic itself is complete and tested;
 * only the "when it runs" wiring is deferred.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async runAll() {
    const [installmentReminders, documentReminders] = await Promise.all([
      this.sendInstallmentAndOverdueReminders(),
      this.sendDocumentMissingReminders(),
    ]);
    return { ...installmentReminders, documentReminders };
  }

  /** One outstanding-balance invoice → one reminder, tagged overdue past OVERDUE_AFTER_DAYS since issue. */
  private async sendInstallmentAndOverdueReminders() {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      },
      include: {
        payments: true,
        customer: { include: { identity: { select: { email: true, id: true } } } },
        hajjRegistration: { include: { package: true } },
        umrahRegistration: { include: { package: true } },
      },
    });

    let installmentCount = 0;
    let overdueCount = 0;
    const now = Date.now();

    for (const invoice of invoices) {
      const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
      const balance = invoice.totalAmount - totalPaid;
      if (balance <= 0) continue;

      const registrationNumber =
        invoice.hajjRegistration?.registrationNumber ??
        invoice.umrahRegistration?.registrationNumber ??
        invoice.invoiceNumber;
      const packageName =
        invoice.hajjRegistration?.package.name ??
        invoice.umrahRegistration?.package.name ??
        'Invoice';

      const ageDays = (now - invoice.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const overdue = ageDays > OVERDUE_AFTER_DAYS;

      await this.notificationsService.sendInstallmentReminder(
        invoice.customer.identity.email,
        invoice.customer.identity.id,
        {
          registrationNumber,
          packageName,
          totalAmount: invoice.totalAmount,
          balance,
          currency: invoice.currency,
          overdue,
        },
      );

      if (overdue) overdueCount++;
      else installmentCount++;
    }

    this.logger.log(
      `Reminders sent: ${installmentCount} installment, ${overdueCount} overdue`,
    );
    return { installmentReminders: installmentCount, overdueReminders: overdueCount };
  }

  /** One reminder per customer missing any of REQUIRED_DOCUMENT_TYPES. */
  private async sendDocumentMissingReminders(): Promise<number> {
    const customers = await this.prisma.customer.findMany({
      include: {
        documents: { select: { type: true } },
        identity: { select: { email: true, id: true } },
      },
    });

    let count = 0;
    for (const customer of customers) {
      const uploadedTypes = new Set(customer.documents.map((d) => d.type));
      const missing = REQUIRED_DOCUMENT_TYPES.filter(
        (type) => !uploadedTypes.has(type),
      );
      if (missing.length === 0) continue;

      await this.notificationsService.sendDocumentMissingReminder(
        customer.identity.email,
        customer.identity.id,
        { missingDocumentTypes: missing },
      );
      count++;
    }
    return count;
  }
}
