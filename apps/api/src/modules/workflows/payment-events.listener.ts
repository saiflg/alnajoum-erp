import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WorkflowEventBus } from './events/workflow-event-bus.service';

/** Shape of the event PaymentsService already emits (see payments.service.ts, InvoicePaymentSucceededEvent). */
interface InvoicePaymentSucceeded {
  invoiceId: string;
  customerId: string;
  amount: number;
  currency: string;
}

/**
 * Bridges the one domain event that already existed (`invoice.payment.succeeded`, in-process and
 * lossy) onto the durable workflow bus, without changing the payments module. The payments
 * service emits it exactly once per confirmed payment, after its own atomic PENDING→SUCCEEDED
 * claim, so no dedupe key is needed here (and none would be correct: an invoice paid in equal
 * instalments legitimately produces several identical-looking events).
 *
 * Known gap: only ONLINE payments emit this event today. Staff-recorded, wallet and
 * manually-approved payments do not, so they cannot trigger workflows yet.
 */
@Injectable()
export class PaymentWorkflowEventsListener {
  private readonly logger = new Logger(PaymentWorkflowEventsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: WorkflowEventBus,
  ) {}

  @OnEvent('invoice.payment.succeeded', { async: true })
  async onPaid(e: InvoicePaymentSucceeded): Promise<void> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: e.customerId },
        select: { companyId: true },
      });
      if (!customer) return;
      await this.bus.publishSafe({
        type: 'payment.succeeded',
        source: 'payments',
        companyId: customer.companyId,
        entityType: 'Invoice',
        entityId: e.invoiceId,
        payload: {
          payment: {
            invoiceId: e.invoiceId,
            amount: e.amount,
            currency: e.currency,
          },
          customer: { id: e.customerId },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not bridge payment event for invoice ${e.invoiceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
