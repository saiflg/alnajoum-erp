import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightBookingStatus, FlightRefundStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../payments/invoices.service';
import { FlightRefundsService } from './flight-refunds.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

describe('FlightRefundsService', () => {
  let service: FlightRefundsService;
  let prisma: {
    flightBooking: { findUnique: jest.Mock; update: jest.Mock };
    flightRefund: { create: jest.Mock; findMany: jest.Mock };
    customer: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: { capabilities: jest.Mock; requestRefund: jest.Mock };
  let integrationsService: {
    getActiveProvider: jest.Mock;
    getCredentialConfig: jest.Mock;
  };

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
      flightRefund: { create: jest.fn(), findMany: jest.fn() },
      customer: { findUnique: jest.fn() },
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
  });

  describe('requestRefund', () => {
    it('rejects refunding an already-refunded booking', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...booking,
        status: FlightBookingStatus.REFUNDED,
      });
      await expect(service.requestRefund('booking-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates a manual-required refund row when the provider does not support automated refunds', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      provider.capabilities.mockResolvedValue({
        ticketing: false,
        refund: false,
        reissue: false,
      });
      prisma.flightRefund.create.mockResolvedValue({
        id: 'refund-1',
        status: FlightRefundStatus.REQUESTED,
      });

      const result = await service.requestRefund('booking-1', {
        requestedByStaffId: 'staff-1',
      });

      expect(provider.requestRefund).not.toHaveBeenCalled();
      expect(result.status).toBe(FlightRefundStatus.REQUESTED);
    });

    it('never assumes the whole ticket price is refunded — subtracts provider penalty and agency fee', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      provider.capabilities.mockResolvedValue({
        ticketing: true,
        refund: true,
        reissue: false,
      });
      provider.requestRefund.mockResolvedValue({
        providerPenalty: 20_000,
        status: 'REFUNDED',
        providerRefundId: 'ref-1',
      });
      prisma.flightRefund.create.mockResolvedValue({ id: 'refund-1' });

      await service.requestRefund('booking-1', {
        requestedByStaffId: 'staff-1',
      });

      // 100_000 - 20_000 penalty - 5_000 agency fee = 75_000
      expect(prisma.flightRefund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundAmount: 75_000,
            providerPenalty: 20_000,
            agencyFee: 5_000,
          }),
        }),
      );
      expect(prisma.flightBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FlightBookingStatus.REFUNDED },
        }),
      );
    });

    it('leaves the booking un-refunded when the provider refund fails', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      provider.capabilities.mockResolvedValue({
        ticketing: true,
        refund: true,
        reissue: false,
      });
      provider.requestRefund.mockResolvedValue({
        providerPenalty: 0,
        status: 'FAILED',
        errorMessage: 'provider down',
      });
      prisma.flightRefund.create.mockResolvedValue({
        id: 'refund-1',
        status: FlightRefundStatus.FAILED,
      });

      await expect(service.requestRefund('booking-1', {})).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.flightRefund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FlightRefundStatus.FAILED,
            refundAmount: 0,
          }),
        }),
      );
    });
  });
});
