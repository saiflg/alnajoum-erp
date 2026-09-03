import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const OVERDUE_AFTER_DAYS = 14;
const REQUIRED_DOCUMENT_TYPES = ['PASSPORT', 'PHOTO'] as const;

/**
 * Reminder sweep — runs automatically once a day (see `runScheduled` below)
 * and can also be triggered on demand from the admin/finance dashboard
 * (`POST /reminders/run`, permission REMINDER.RUN) for testing or an
 * out-of-cycle nudge. Both paths call the same `runAll()`.
 *
 * Deliberately simple: every outstanding invoice / customer with a missing
 * document gets a reminder on every run, with no per-recipient frequency
 * cap or "already reminded today" dedup. A daily cron cadence keeps that
 * reasonable in practice; a higher-volume production deployment would want
 * to track last-reminded-at per invoice/customer before increasing the
 * frequency further.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Daily at 08:00 server time — installment/overdue/missing-document sweep. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async runScheduled(): Promise<void> {
    this.logger.log('Running scheduled reminder sweep');
    const result = await this.runAll();
    this.logger.log(
      `Scheduled reminder sweep complete: ${JSON.stringify(result)}`,
    );
  }

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
        customer: {
          include: {
            identity: { select: { email: true, id: true, phone: true } },
          },
        },
        hajjRegistration: { include: { package: true } },
        umrahRegistration: { include: { package: true } },
      },
    });

    let installmentCount = 0;
    let overdueCount = 0;
    const now = Date.now();

    for (const invoice of invoices) {
      // Corporate travel invoices have no customer to remind (billed to a
      // CorporateAccount instead — see Invoice.customerId's comment in
      // schema.prisma); everything else this query selects always has one.
      if (!invoice.customer) continue;

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

      const ageDays =
        (now - invoice.createdAt.getTime()) / (1000 * 60 * 60 * 24);
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
        invoice.customer.identity.phone,
        invoice.customer.whatsapp,
      );

      if (overdue) overdueCount++;
      else installmentCount++;
    }

    this.logger.log(
      `Reminders sent: ${installmentCount} installment, ${overdueCount} overdue`,
    );
    return {
      installmentReminders: installmentCount,
      overdueReminders: overdueCount,
    };
  }

  /** One reminder per customer missing any of REQUIRED_DOCUMENT_TYPES. */
  private async sendDocumentMissingReminders(): Promise<number> {
    const customers = await this.prisma.customer.findMany({
      include: {
        documents: { select: { type: true } },
        identity: { select: { email: true, id: true, phone: true } },
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
        customer.identity.phone,
        customer.whatsapp,
      );
      count++;
    }
    return count;
  }
}
