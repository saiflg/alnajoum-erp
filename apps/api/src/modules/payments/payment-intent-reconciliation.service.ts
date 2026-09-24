import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentIntentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PaymentsService } from './payments.service';

/** Only intents at least this old are polled — gives the customer's own
 * browser-return verifyCheckout() call (or, for Paystack, the webhook)
 * every reasonable chance to finalize first, so this isn't racing the
 * normal fast path on every single checkout. */
const MIN_AGE_MINUTES = 5;

/** Stop polling an abandoned checkout after this long — an intent this
 * old that's still PENDING is almost certainly a customer who never
 * completed payment, not a confirmation we're about to miss. */
const MAX_AGE_HOURS = 48;

const BATCH_SIZE = 100;

/**
 * Closes the reliability gap OpayPaymentProviderService's own doc
 * comment documents: OPay has no webhook, so without this, "did the
 * customer pay" is only ever discovered if their browser happens to
 * return to the callback page — never true for a payment link sent over
 * WhatsApp, where there's no browser session to return to at all. This
 * benefits every PENDING intent regardless of how it was created (portal
 * checkout, WhatsApp payment link, any future entry point) and regardless
 * of provider — Paystack intents are included too, as a backstop in case
 * a webhook delivery is ever lost, not because Paystack needs this as its
 * primary path.
 *
 * Reuses PaymentsService.reconcilePendingIntent for the actual
 * verify+finalize — this service is just the "which intents are
 * candidates" query plus the sweep loop, mirroring
 * FlightRefundsService.runApprovedRefundSweep's shape.
 */
@Injectable()
export class PaymentIntentReconciliationService {
  private readonly logger = new Logger(PaymentIntentReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runReconciliationSweep(): Promise<{
    considered: number;
    succeeded: number;
    stillPending: number;
    failed: number;
  }> {
    const now = Date.now();
    const minAge = new Date(now - MIN_AGE_MINUTES * 60_000);
    const maxAge = new Date(now - MAX_AGE_HOURS * 60 * 60_000);

    const candidates = await this.prisma.paymentIntent.findMany({
      where: {
        status: PaymentIntentStatus.PENDING,
        createdAt: { lte: minAge, gte: maxAge },
      },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    let succeeded = 0;
    let stillPending = 0;
    let failed = 0;

    for (const intent of candidates) {
      try {
        const outcome = await this.paymentsService.reconcilePendingIntent(
          intent.id,
        );
        if (!outcome.ok) {
          failed++;
          continue;
        }
        const refreshed = await this.prisma.paymentIntent.findUnique({
          where: { id: intent.id },
          select: { status: true },
        });
        if (refreshed?.status === PaymentIntentStatus.SUCCEEDED) {
          succeeded++;
        } else {
          stillPending++;
        }
      } catch (error) {
        failed++;
        this.logger.warn(
          `Reconciliation failed for payment intent ${intent.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const result = {
      considered: candidates.length,
      succeeded,
      stillPending,
      failed,
    };
    if (candidates.length > 0) {
      this.logger.log(
        `Payment intent reconciliation sweep: ${JSON.stringify(result)}`,
      );
    }
    return result;
  }
}
