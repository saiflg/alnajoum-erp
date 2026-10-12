import { Injectable, Logger } from '@nestjs/common';
import { TaskPriority, TaskRelatedType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type FinanceAlertKind = 'SURPLUS_CREDIT' | 'AMOUNT_MISMATCH';

interface RaiseInput {
  kind: FinanceAlertKind;
  companyId: string | null;
  customerId: string;
  /** The payment intent or wallet transaction the alert is about; one open alert per (kind, id). */
  relatedId: string;
  reference: string;
  title: string;
  description: string;
  priority: TaskPriority;
  metadata: Record<string, unknown>;
}

/**
 * Puts money problems in front of a person. Two things used to be only a log line:
 *  - a customer paid after their invoice was already settled (the extra is now credited to their wallet, but
 *    Finance should decide whether to refund it), and
 *  - a payment provider confirmed a payment whose amount or currency does not match what was expected (the
 *    payment is deliberately NOT credited and stays pending, which only helps if someone looks at it).
 *
 * Each becomes a task for the company's Finance officer (or, failing that, its administrator) and an audit
 * event. The task list is the queue: it has owners, due dates and a status, and an open alert is never raised
 * twice for the same payment even though the reconciliation job re-checks pending payments repeatedly.
 * This service never throws: an alert that cannot be raised is logged and must not undo or block a payment.
 */
@Injectable()
export class FinanceAlertsService {
  private readonly logger = new Logger(FinanceAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Credit left on a customer's wallet because their payment arrived after the invoice was settled. */
  async surplusCredited(input: {
    companyId: string | null;
    customerId: string;
    intentId: string;
    reference: string;
    invoiceId: string;
    amount: number;
    currency: string;
    invoiceState: string;
  }): Promise<void> {
    const invoice = await this.prisma.invoice
      .findUnique({
        where: { id: input.invoiceId },
        select: { invoiceNumber: true },
      })
      .catch(() => null);
    const invoiceNumber = invoice?.invoiceNumber;
    return this.raise({
      kind: 'SURPLUS_CREDIT',
      companyId: input.companyId,
      customerId: input.customerId,
      relatedId: input.intentId,
      reference: input.reference,
      title: `Review surplus payment ${input.reference}`,
      description:
        `A customer payment of ${input.amount} ${input.currency} (${input.reference}) arrived after the invoice` +
        `${invoiceNumber ? ` ${invoiceNumber}` : ''} was already ${input.invoiceState}. ` +
        'Nothing was applied to the invoice; the amount was credited to the customer wallet as credit on account ' +
        `(wallet transaction SURPLUS-${input.reference}). Decide whether to leave it as credit or refund it.`,
      priority: TaskPriority.NORMAL,
      metadata: {
        amount: input.amount,
        currency: input.currency,
        invoiceState: input.invoiceState,
      },
    });
  }

  /** A provider confirmed a payment, but not for the amount / currency we expected. Not credited; needs a person. */
  amountMismatch(input: {
    customerId: string;
    relatedId: string;
    reference: string;
    expected: { amount: number; currency: string };
    received: { amount: number; currency: string };
    source: 'invoice checkout' | 'wallet deposit';
  }): Promise<void> {
    return this.raise({
      kind: 'AMOUNT_MISMATCH',
      companyId: null, // resolved from the customer
      customerId: input.customerId,
      relatedId: input.relatedId,
      reference: input.reference,
      title: `Payment amount mismatch ${input.reference}`,
      description:
        `The payment provider confirmed ${input.reference} (${input.source}) as paid, but for ` +
        `${input.received.amount} ${input.received.currency} when ${input.expected.amount} ${input.expected.currency} ` +
        'was expected. The payment has NOT been credited and stays pending. Check it with the provider before ' +
        'crediting, refunding or rejecting it.',
      priority: TaskPriority.URGENT,
      metadata: { expected: input.expected, received: input.received },
    });
  }

  private async raise(input: RaiseInput): Promise<void> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: input.customerId },
        select: { companyId: true },
      });
      const companyId = input.companyId ?? customer?.companyId ?? null;
      if (!companyId) return;

      const open = await this.prisma.task.findFirst({
        where: {
          relatedType: TaskRelatedType.PAYMENT,
          relatedId: input.relatedId,
          title: input.title,
          status: {
            in: [
              TaskStatus.PENDING,
              TaskStatus.IN_PROGRESS,
              TaskStatus.OVERDUE,
            ],
          },
        },
        select: { id: true },
      });
      if (open) return;

      const assignee = await this.assignee(companyId);
      if (assignee) {
        const due = new Date();
        due.setDate(due.getDate() + (input.kind === 'AMOUNT_MISMATCH' ? 1 : 3));
        await this.prisma.task.create({
          data: {
            title: input.title,
            description: input.description,
            relatedType: TaskRelatedType.PAYMENT,
            relatedId: input.relatedId,
            customerId: input.customerId,
            assignedStaffId: assignee,
            isAutoCreated: true,
            dueDate: due,
            priority: input.priority,
          },
        });
      } else {
        this.logger.error(
          `No Finance officer or administrator to assign "${input.title}" in company ${companyId}`,
        );
      }

      await this.audit.record({
        action:
          input.kind === 'AMOUNT_MISMATCH'
            ? 'security.payment_amount_mismatch'
            : 'finance.surplus_credit_created',
        entityType:
          input.kind === 'AMOUNT_MISMATCH'
            ? 'PaymentIntent'
            : 'WalletTransaction',
        entityId: input.relatedId,
        companyId,
        metadata: { reference: input.reference, ...input.metadata },
      });
    } catch (err) {
      this.logger.error(
        `Could not raise finance alert "${input.title}": ${(err as Error).message}`,
      );
    }
  }

  /** A Finance officer of the company; otherwise a company administrator; otherwise nobody. */
  private async assignee(companyId: string): Promise<string | null> {
    for (const role of ['FINANCE_OFFICER', 'COMPANY_ADMIN']) {
      const staff = await this.prisma.staff.findFirst({
        where: {
          companyId,
          identity: {
            status: 'ACTIVE',
            roles: { some: { role: { name: role } } },
          },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (staff) return staff.id;
    }
    return null;
  }
}
