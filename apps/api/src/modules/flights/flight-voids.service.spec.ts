import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FlightBookingStatus,
  FlightProviderName,
  FlightVoidStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinancePostingService } from '../finance/finance-posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlightVoidsService } from './flight-voids.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe('FlightVoidsService', () => {
  let service: FlightVoidsService;
  let prisma: {
    flightBooking: { findUnique: jest.Mock; update: jest.Mock };
    flightVoid: { create: jest.Mock; findMany: jest.Mock };
    customer: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: {
    capabilities: jest.Mock;
    requestVoid: jest.Mock;
  };
  let providerLog: { record: jest.Mock };
  let financePostingService: {
    postRefund: jest.Mock;
    cancelIncentivesForSource: jest.Mock;
  };
  let notificationsService: { sendGeneric: jest.Mock };
  let auditService: { record: jest.Mock };

  const ticketedBooking = {
    id: 'booking-1',
    bookingReference: 'ANJ-AAAA1111',
    customerId: 'cust-1',
    status: FlightBookingStatus.TICKETED,
    ticketedAt: hoursAgo(2),
    providerOrderId: 'ord_1',
    provider: FlightProviderName.MOCK,
    totalAmount: 500_000,
    currency: 'NGN',
    passengers: [{ ticketNumber: 'TKT001' }, { ticketNumber: 'TKT002' }],
  };

  beforeEach(async () => {
    prisma = {
      flightBooking: { findUnique: jest.fn(), update: jest.fn() },
      flightVoid: { create: jest.fn(), findMany: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
    };
    provider = {
      capabilities: jest.fn().mockResolvedValue({ void: true }),
      requestVoid: jest.fn(),
    };
    providerLog = { record: jest.fn() };
    financePostingService = {
      postRefund: jest.fn(),
      cancelIncentivesForSource: jest.fn(),
    };
    notificationsService = { sendGeneric: jest.fn() };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightVoidsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        { provide: ProviderTransactionLogService, useValue: providerLog },
        { provide: FinancePostingService, useValue: financePostingService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(FlightVoidsService);
  });

  describe('getEligibility', () => {
    it('throws NotFound for a missing booking', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(null);

      await expect(service.getEligibility('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ineligible when the booking is not TICKETED', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...ticketedBooking,
        status: FlightBookingStatus.CONFIRMED,
      });

      const result = await service.getEligibility('booking-1');

      expect(result.eligible).toBe(false);
    });

    it('eligible within the 24-hour void window', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue(ticketedBooking);

      const result = await service.getEligibility('booking-1');

      expect(result.eligible).toBe(true);
      expect(result.voidDeadline).not.toBeNull();
    });

    it('ineligible once the void window has passed', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...ticketedBooking,
        ticketedAt: hoursAgo(48),
      });

      const result = await service.getEligibility('booking-1');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('void window');
    });
  });

  describe('requestVoid', () => {
    beforeEach(() => {
      prisma.flightBooking.findUnique.mockResolvedValue({ ...ticketedBooking });
      prisma.flightVoid.create.mockResolvedValue({ id: 'void-1' });
      prisma.customer.findUnique.mockResolvedValue({
        identity: { email: 'amina@example.com', id: 'identity-1' },
      });
    });

    it('rejects a non-ticketed booking', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...ticketedBooking,
        status: FlightBookingStatus.CONFIRMED,
      });

      await expect(service.requestVoid('booking-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('routes a manual/offline booking (no provider order) to the manual-required path instead of failing', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...ticketedBooking,
        providerOrderId: null,
      });
      prisma.flightVoid.create.mockResolvedValue({ id: 'void-1' });

      await service.requestVoid('booking-1', 'staff-1');

      expect(prisma.flightVoid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: FlightVoidStatus.REQUESTED }),
      });
      expect(provider.requestVoid).not.toHaveBeenCalled();
    });

    it('rejects once the void window has passed', async () => {
      prisma.flightBooking.findUnique.mockResolvedValue({
        ...ticketedBooking,
        ticketedAt: hoursAgo(48),
      });

      await expect(service.requestVoid('booking-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('records a manual-required void when the provider does not support void', async () => {
      provider.capabilities.mockResolvedValue({ void: false });

      await service.requestVoid('booking-1', 'staff-1');

      expect(prisma.flightVoid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: FlightVoidStatus.REQUESTED }),
      });
      expect(provider.requestVoid).not.toHaveBeenCalled();
    });

    it('reverses the full amount (no penalty) and cancels incentives on a successful void', async () => {
      provider.requestVoid.mockResolvedValue({ status: 'VOIDED' });

      await service.requestVoid('booking-1', 'staff-1');

      expect(financePostingService.postRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500_000,
          sourceModule: 'FLIGHT_VOID',
        }),
      );
      expect(
        financePostingService.cancelIncentivesForSource,
      ).toHaveBeenCalledWith('FLIGHT_BOOKING', 'booking-1', expect.any(String));
      expect(prisma.flightBooking.update).toHaveBeenLastCalledWith({
        where: { id: 'booking-1' },
        data: { status: FlightBookingStatus.VOIDED },
      });
    });

    it('reverts the booking status and throws when the provider fails', async () => {
      provider.requestVoid.mockResolvedValue({
        status: 'FAILED',
        errorMessage: 'GDS error',
      });

      await expect(service.requestVoid('booking-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
      expect(financePostingService.postRefund).not.toHaveBeenCalled();
    });
  });
});
