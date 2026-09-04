import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightBookingStatus, FlightReissueStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlightReissueService } from './flight-reissue.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

describe('FlightReissueService', () => {
  let service: FlightReissueService;
  let prisma: {
    flightBooking: { findUnique: jest.Mock; update: jest.Mock };
    flightReissue: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    flightBookingPassenger: { findMany: jest.Mock };
    customer: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: {
    getOffer: jest.Mock;
    capabilities: jest.Mock;
    reissue: jest.Mock;
  };

  const booking = {
    id: 'booking-1',
    status: FlightBookingStatus.TICKETED,
    providerOrderId: 'MOCK-1',
    provider: 'MOCK',
    totalAmount: 100_000,
    currency: 'NGN',
    itinerary: {},
    customerId: 'customer-1',
    origin: 'LOS',
    destination: 'ABV',
    bookingReference: 'ANJ-ABCD1234',
  };

  beforeEach(async () => {
    prisma = {
      flightBooking: { findUnique: jest.fn(), update: jest.fn() },
      flightReissue: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      flightBookingPassenger: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
    };
    provider = {
      getOffer: jest.fn(),
      capabilities: jest.fn(),
      reissue: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightReissueService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        {
          provide: IntegrationsService,
          useValue: {
            getActiveProvider: jest.fn().mockResolvedValue('mock'),
            getCredentialConfig: jest
              .fn()
              .mockResolvedValue({ changePenaltyPercent: '3' }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock') },
        },
        { provide: NotificationsService, useValue: { sendGeneric: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: ProviderTransactionLogService,
          useValue: { record: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(FlightReissueService);
  });

  describe('requestReissue', () => {
    it('rejects reissuing a booking that has not been ticketed yet', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...booking,
        status: FlightBookingStatus.CONFIRMED,
      });
      await expect(
        service.requestReissue('booking-1', 'offer-2', 'staff-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('computes fare difference plus a configurable change penalty', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(booking);
      provider.getOffer.mockResolvedValue({
        totalAmount: 130_000,
        currency: 'NGN',
      });
      prisma.flightReissue.create.mockResolvedValue({
        id: 'reissue-1',
        totalDue: 33_000,
      });

      await service.requestReissue('booking-1', 'offer-2', 'staff-1');

      // fareDifference = 130_000 - 100_000 = 30_000; penalty = 3% of 100_000 = 3_000
      expect(prisma.flightReissue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fareDifference: 30_000,
            changePenalty: 3_000,
            totalDue: 33_000,
          }),
        }),
      );
    });
  });

  describe('completeReissue', () => {
    it('requires a manual PNR when the provider does not support automated reissue', async () => {
      prisma.flightReissue.findUnique.mockResolvedValue({
        id: 'reissue-1',
        status: FlightReissueStatus.AWAITING_PAYMENT,
        newOfferSnapshot: { totalAmount: 130_000 },
        booking,
      });
      provider.capabilities.mockResolvedValue({
        ticketing: true,
        refund: true,
        reissue: false,
      });

      await expect(
        service.completeReissue('reissue-1', 'staff-1'),
      ).rejects.toThrow(BadRequestException);
      expect(provider.reissue).not.toHaveBeenCalled();
    });

    it('never marks a reissue complete when the provider fails, and reverts the booking to TICKETED', async () => {
      prisma.flightReissue.findUnique.mockResolvedValue({
        id: 'reissue-1',
        status: FlightReissueStatus.AWAITING_PAYMENT,
        newOfferSnapshot: { totalAmount: 130_000 },
        booking,
      });
      provider.capabilities.mockResolvedValue({
        ticketing: true,
        refund: true,
        reissue: true,
      });
      provider.reissue.mockResolvedValue({
        providerOrderId: '',
        pnr: '',
        status: 'FAILED',
        errorMessage: 'boom',
      });

      await expect(
        service.completeReissue('reissue-1', 'staff-1'),
      ).rejects.toThrow(ConflictException);
      // Reverted back to TICKETED, not left mid-reissue — and never given a
      // new PNR/itinerary, since finalize() (the success path) never runs.
      expect(prisma.flightReissue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FlightReissueStatus.FAILED },
        }),
      );
      expect(prisma.flightBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: FlightBookingStatus.TICKETED },
        }),
      );
    });
  });
});
