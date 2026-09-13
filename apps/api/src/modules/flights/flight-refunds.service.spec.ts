import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApprovalRequestStatus,
  FlightBookingStatus,
  FlightRefundStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { ApprovalsService } from '../governance/approvals.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { FlightRefundsService } from './flight-refunds.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

// @nestjs/schedule ships an ESM build Jest's default transform can't parse —
// same workaround as visa-ops-automation.service.spec.ts.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_5_MINUTES: '*/5 * * * *' },
}));

describe('FlightRefundsService', () => {
  let service: FlightRefundsService;
  let prisma: {
    flightBooking: { findUnique: jest.Mock; update: jest.Mock };
    flightRefund: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    customer: { findUnique: jest.Mock };
    approvalRequest: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: { capabilities: jest.Mock; requestRefund: jest.Mock };
  let integrationsService: {
    getActiveProvider: jest.Mock;
    getCredentialConfig: jest.Mock;
  };
  let approvalsService: { createRequest: jest.Mock };

  const booking = {
    id: 'booking-1',
    status: FlightBookingStatus.TICKETED,
    providerOrderId: 'MOCK-1',
    provider: 'MOCK',
    totalAmount: 100_000,
    currency: 'NGN',
    refundable: false,
    fareRules: null,
    customerId: 'customer-1',
    bookingReference: 'ANJ-ABCD1234',
  };

  beforeEach(async () => {
    prisma = {
      flightBooking: { findUnique: jest.fn(), update: jest.fn() },
      flightRefund: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
      },
      approvalRequest: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
    };
    provider = { capabilities: jest.fn(), requestRefund: jest.fn() };
    integrationsService = {
      getActiveProvider: jest.fn().mockResolvedValue('mock'),
      getCredentialConfig: jest
        .fn()
        .mockResolvedValue({ agencyFeePercent: '5' }),
    };
    approvalsService = {
      createRequest: jest
        .fn()
        .mockResolvedValue({ id: 'approval-1', requiredApprovals: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightRefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        { provide: IntegrationsService, useValue: integrationsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock') },
        },
        { provide: InvoicesService, useValue: { voidIfUnpaid: jest.fn() } },
        { provide: NotificationsService, useValue: { sendGeneric: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: ProviderTransactionLogService,
          useValue: { record: jest.fn() },
        },
        {
          provide: FinancePostingService,
          useValue: {
            postRefund: jest.fn(),
            cancelIncentivesForSource: jest.fn(),
          },
        },
        { provide: ApprovalsService, useValue: approvalsService },
      ],
    }).compile();
    service = module.get(FlightRefundsService);
  });

  describe('previewRefund', () => {
    it('computes the estimated refund minus penalty and agency fee for a non-refundable fare', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      const preview = await service.previewRefund('booking-1');
      // 5% agency fee = 5_000; non-refundable -> 100% provider penalty = 100_000
      expect(preview.agencyFee).toBe(5_000);
      expect(preview.estimatedProviderPenalty).toBe(100_000);
      expect(preview.estimatedRefundAmount).toBe(0); // floored at 0, never negative
    });

    it('estimates a smaller penalty for a refundable fare', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...booking,
        refundable: true,
      });
      const preview = await service.previewRefund('booking-1');
      expect(preview.estimatedProviderPenalty).toBe(0);
      expect(preview.estimatedRefundAmount).toBe(95_000);
    });

    it('applies only a 25% penalty for a partially-refundable fare, matching what the approved refund will actually charge', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...booking,
        refundable: false,
        fareRules: { refundable: 'PARTIALLY_REFUNDABLE' },
      });
      const preview = await service.previewRefund('booking-1');
      expect(preview.estimatedProviderPenalty).toBe(25_000);
      expect(preview.estimatedRefundAmount).toBe(70_000);
    });
  });

  /**
   * Phase 11 spec #10/#11 — requestRefund no longer touches the provider
   * or moves money at all; it only records the estimate and opens the
   * generic ApprovalRequest the FLIGHT_REFUND threshold rules gate.
   */
  describe('requestRefund', () => {
    it('rejects refunding an already-refunded booking', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...booking,
        status: FlightBookingStatus.REFUNDED,
      });

      await expect(
        service.requestRefund('booking-1', {
          requestedByIdentityId: 'identity-1',
        }),
      ).rejects.toThrow(ConflictException);
      expect(approvalsService.createRequest).not.toHaveBeenCalled();
    });

    it('never calls the provider — only creates the estimate and the approval request', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      prisma.flightRefund.create.mockResolvedValue({
        id: 'refund-1',
        status: FlightRefundStatus.REQUESTED,
      });

      const result = await service.requestRefund('booking-1', {
        requestedByStaffId: 'staff-1',
        requestedByIdentityId: 'identity-1',
      });

      expect(provider.requestRefund).not.toHaveBeenCalled();
      expect(result.refund.status).toBe(FlightRefundStatus.REQUESTED);
      expect(result.approvalRequest.id).toBe('approval-1');
    });

    it('estimates the refund amount and passes it (with the resolved company) to the approval engine', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      prisma.flightRefund.create.mockResolvedValue({ id: 'refund-1' });

      await service.requestRefund('booking-1', {
        requestedByIdentityId: 'identity-1',
      });

      // 100_000 ticket, non-refundable -> 100_000 penalty, 5_000 agency fee -> 0 refund
      expect(prisma.flightRefund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundAmount: 0,
            providerPenalty: 100_000,
            agencyFee: 5_000,
            status: FlightRefundStatus.REQUESTED,
          }),
        }),
      );
      expect(approvalsService.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FLIGHT_REFUND',
          amount: 0,
          entityType: 'FlightRefund',
          entityId: 'refund-1',
          requestedByIdentityId: 'identity-1',
          companyId: 'company-1',
        }),
      );
    });

    it('moves the booking to REFUND_REQUESTED', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      prisma.flightRefund.create.mockResolvedValue({ id: 'refund-1' });

      await service.requestRefund('booking-1', {
        requestedByIdentityId: 'identity-1',
      });

      expect(prisma.flightBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FlightBookingStatus.REFUND_REQUESTED },
        }),
      );
    });
  });

  /**
   * The execution/rejection side, run only by the sweep — mirrors how
   * StaffPayoutsService.runAutomaticPayoutSweep is tested through its
   * public entry point rather than a private helper.
   */
  describe('runApprovedRefundSweep', () => {
    const approvedRequest = {
      status: ApprovalRequestStatus.APPROVED,
      entityId: 'refund-1',
    };
    const pendingRefund = {
      id: 'refund-1',
      status: FlightRefundStatus.REQUESTED,
      bookingId: 'booking-1',
      agencyFee: 5_000,
      providerResponse: { originalBookingStatus: FlightBookingStatus.TICKETED },
      booking,
    };

    it('does nothing when there are no resolved FLIGHT_REFUND requests', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([]);

      const result = await service.runApprovedRefundSweep();

      expect(result).toEqual({
        considered: 0,
        executed: 0,
        rejected: 0,
        failed: 0,
      });
    });

    it('skips a request whose refund was already executed (idempotent)', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([approvedRequest]);
      prisma.flightRefund.findMany.mockResolvedValue([]); // no longer REQUESTED

      const result = await service.runApprovedRefundSweep();

      expect(result.considered).toBe(0);
      expect(prisma.flightRefund.findUnique).not.toHaveBeenCalled();
    });

    it('executes an approved refund: calls the provider, completes the refund, refunds the booking, posts finance', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([approvedRequest]);
      prisma.flightRefund.findMany.mockResolvedValue([{ id: 'refund-1' }]);
      prisma.flightRefund.findUnique.mockResolvedValue(pendingRefund);
      provider.capabilities.mockResolvedValue({ refund: true });
      provider.requestRefund.mockResolvedValue({
        providerPenalty: 20_000,
        status: 'REFUNDED',
        providerRefundId: 'ref-1',
      });
      prisma.customer.findUnique.mockResolvedValue({
        identity: { email: 'c@example.com', id: 'identity-c' },
      });

      const result = await service.runApprovedRefundSweep();

      // 100_000 - 20_000 penalty - 5_000 agency fee (from the stored refund row) = 75_000
      expect(prisma.flightRefund.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'refund-1' },
          data: expect.objectContaining({
            status: FlightRefundStatus.COMPLETED,
            refundAmount: 75_000,
            providerPenalty: 20_000,
          }),
        }),
      );
      expect(prisma.flightBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FlightBookingStatus.REFUNDED },
        }),
      );
      expect(result.executed).toBe(1);
    });

    it('records PROCESSING (never calls the provider) when it lacks automated refund support', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([approvedRequest]);
      prisma.flightRefund.findMany.mockResolvedValue([{ id: 'refund-1' }]);
      prisma.flightRefund.findUnique.mockResolvedValue(pendingRefund);
      provider.capabilities.mockResolvedValue({ refund: false });

      await service.runApprovedRefundSweep();

      expect(provider.requestRefund).not.toHaveBeenCalled();
      expect(prisma.flightRefund.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FlightRefundStatus.PROCESSING,
          }),
        }),
      );
    });

    it('reverts the booking to its pre-request status and marks FAILED on a provider failure', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([approvedRequest]);
      prisma.flightRefund.findMany.mockResolvedValue([{ id: 'refund-1' }]);
      prisma.flightRefund.findUnique.mockResolvedValue(pendingRefund);
      provider.capabilities.mockResolvedValue({ refund: true });
      provider.requestRefund.mockResolvedValue({
        providerPenalty: 0,
        status: 'FAILED',
        errorMessage: 'provider down',
      });

      const result = await service.runApprovedRefundSweep();

      expect(prisma.flightBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FlightBookingStatus.TICKETED },
        }),
      );
      expect(prisma.flightRefund.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FlightRefundStatus.FAILED }),
        }),
      );
      expect(result.executed).toBe(1); // "executed" = the sweep processed it, not that money moved
    });

    it('rejects a REJECTED request: reverts the booking and marks the refund REJECTED', async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        { status: ApprovalRequestStatus.REJECTED, entityId: 'refund-1' },
      ]);
      prisma.flightRefund.findMany.mockResolvedValue([{ id: 'refund-1' }]);
      prisma.flightRefund.findUnique.mockResolvedValue(pendingRefund);

      const result = await service.runApprovedRefundSweep();

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(provider.requestRefund).not.toHaveBeenCalled();
      expect(result.rejected).toBe(1);
    });

    it("keeps sweeping the rest of the batch when one candidate's execution throws", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        approvedRequest,
        { status: ApprovalRequestStatus.APPROVED, entityId: 'refund-2' },
      ]);
      prisma.flightRefund.findMany.mockResolvedValue([
        { id: 'refund-1' },
        { id: 'refund-2' },
      ]);
      prisma.flightRefund.findUnique
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValueOnce({ ...pendingRefund, id: 'refund-2' });
      provider.capabilities.mockResolvedValue({ refund: false });

      const result = await service.runApprovedRefundSweep();

      expect(result).toEqual({
        considered: 2,
        executed: 1,
        rejected: 0,
        failed: 1,
      });
    });
  });
});
