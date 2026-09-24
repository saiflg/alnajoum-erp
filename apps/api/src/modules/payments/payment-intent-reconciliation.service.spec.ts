import { Test, TestingModule } from '@nestjs/testing';
import { PaymentIntentStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PaymentIntentReconciliationService } from './payment-intent-reconciliation.service';
import { PaymentsService } from './payments.service';

// @nestjs/schedule ships an ESM build Jest's default transform can't parse —
// same workaround as flight-refunds.service.spec.ts.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_10_MINUTES: '*/10 * * * *' },
}));

describe('PaymentIntentReconciliationService', () => {
  let service: PaymentIntentReconciliationService;
  let prisma: {
    paymentIntent: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let paymentsService: { reconcilePendingIntent: jest.Mock };

  beforeEach(async () => {
    prisma = {
      paymentIntent: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    paymentsService = { reconcilePendingIntent: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();

    service = module.get(PaymentIntentReconciliationService);
  });

  it('does nothing when there are no stale PENDING intents', async () => {
    prisma.paymentIntent.findMany.mockResolvedValue([]);

    const result = await service.runReconciliationSweep();

    expect(result).toEqual({
      considered: 0,
      succeeded: 0,
      stillPending: 0,
      failed: 0,
    });
    expect(paymentsService.reconcilePendingIntent).not.toHaveBeenCalled();
  });

  it('only queries PENDING intents within the min/max age window', async () => {
    prisma.paymentIntent.findMany.mockResolvedValue([]);

    await service.runReconciliationSweep();

    const call = prisma.paymentIntent.findMany.mock.calls[0][0] as {
      where: { status: string; createdAt: { lte: Date; gte: Date } };
    };
    expect(call.where.status).toBe(PaymentIntentStatus.PENDING);
    expect(call.where.createdAt.lte).toBeInstanceOf(Date);
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    // The min-age cutoff must be after the max-age cutoff (a narrower,
    // more-recent-but-not-too-recent window), not the reverse.
    expect(call.where.createdAt.lte.getTime()).toBeGreaterThan(
      call.where.createdAt.gte.getTime(),
    );
  });

  it('counts a reconciled intent as succeeded once its status flips to SUCCEEDED', async () => {
    prisma.paymentIntent.findMany.mockResolvedValue([{ id: 'intent-1' }]);
    paymentsService.reconcilePendingIntent.mockResolvedValue({ ok: true });
    prisma.paymentIntent.findUnique.mockResolvedValue({
      status: PaymentIntentStatus.SUCCEEDED,
    });

    const result = await service.runReconciliationSweep();

    expect(result).toEqual({
      considered: 1,
      succeeded: 1,
      stillPending: 0,
      failed: 0,
    });
  });

  it('counts an intent that reconciled ok but is still PENDING as stillPending, not succeeded', async () => {
    prisma.paymentIntent.findMany.mockResolvedValue([{ id: 'intent-1' }]);
    paymentsService.reconcilePendingIntent.mockResolvedValue({ ok: true });
    prisma.paymentIntent.findUnique.mockResolvedValue({
      status: PaymentIntentStatus.PENDING,
    });

    const result = await service.runReconciliationSweep();

    expect(result.stillPending).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it("one bad intent doesn't stop the rest of the batch", async () => {
    prisma.paymentIntent.findMany.mockResolvedValue([
      { id: 'intent-1' },
      { id: 'intent-2' },
    ]);
    paymentsService.reconcilePendingIntent
      .mockRejectedValueOnce(new Error('provider unreachable'))
      .mockResolvedValueOnce({ ok: true });
    prisma.paymentIntent.findUnique.mockResolvedValue({
      status: PaymentIntentStatus.SUCCEEDED,
    });

    const result = await service.runReconciliationSweep();

    expect(result).toEqual({
      considered: 2,
      succeeded: 1,
      stillPending: 0,
      failed: 1,
    });
    expect(paymentsService.reconcilePendingIntent).toHaveBeenCalledTimes(2);
  });

  it('counts an ok:false outcome (e.g. provider confirms failure) as failed', async () => {
    prisma.paymentIntent.findMany.mockResolvedValue([{ id: 'intent-1' }]);
    paymentsService.reconcilePendingIntent.mockResolvedValue({
      ok: false,
      reason: 'The payment was not successful.',
    });

    const result = await service.runReconciliationSweep();

    expect(result.failed).toBe(1);
    expect(prisma.paymentIntent.findUnique).not.toHaveBeenCalled();
  });
});
