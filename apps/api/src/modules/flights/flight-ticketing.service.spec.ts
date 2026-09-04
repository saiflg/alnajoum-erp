import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightBookingStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlightIncentivesService } from './flight-incentives.service';
import { FlightTicketingService } from './flight-ticketing.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

describe('FlightTicketingService', () => {
  let service: FlightTicketingService;
  let prisma: {
    flightBooking: { findUnique: jest.Mock; update: jest.Mock };
    flightBookingPassenger: { update: jest.Mock };
    customer: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let provider: { issueTicket: jest.Mock };
  let flightIncentivesService: { createForTicketedBooking: jest.Mock };
  let providerLog: { record: jest.Mock };

  const bookingBase = {
    id: 'booking-1',
    status: FlightBookingStatus.CONFIRMED,
    providerOrderId: 'MOCK-1',
    provider: 'MOCK',
    itinerary: {},
    passengers: [{ id: 'pax-1' }],
    invoice: { status: InvoiceStatus.PAID },
    customerId: 'customer-1',
    origin: 'LOS',
    destination: 'ABV',
    bookingReference: 'ANJ-ABCD1234',
  };

  beforeEach(async () => {
    prisma = {
      flightBooking: { findUnique: jest.fn(), update: jest.fn() },
      flightBookingPassenger: { update: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
    };
    provider = { issueTicket: jest.fn() };
    flightIncentivesService = { createForTicketedBooking: jest.fn() };
    providerLog = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightTicketingService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        { provide: NotificationsService, useValue: { sendGeneric: jest.fn() } },
        { provide: FlightIncentivesService, useValue: flightIncentivesService },
        { provide: ProviderTransactionLogService, useValue: providerLog },
      ],
    }).compile();
    service = module.get(FlightTicketingService);
  });

  it('rejects issuing a ticket for an already-ticketed booking', async () => {
    prisma.flightBooking.findUnique.mockResolvedValue({
      ...bookingBase,
      status: FlightBookingStatus.TICKETED,
    });
    await expect(service.issueTicket('booking-1', 'staff-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects issuing a ticket before the invoice is paid', async () => {
    prisma.flightBooking.findUnique.mockResolvedValue({
      ...bookingBase,
      invoice: { status: InvoiceStatus.ISSUED },
    });
    await expect(service.issueTicket('booking-1', 'staff-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(provider.issueTicket).not.toHaveBeenCalled();
  });

  it('never marks a booking ticketed when the provider fails to issue', async () => {
    prisma.flightBooking.findUnique.mockResolvedValue(bookingBase);
    provider.issueTicket.mockResolvedValue({
      pnr: '',
      status: 'FAILED',
      errorMessage: 'boom',
    });

    await expect(service.issueTicket('booking-1', 'staff-1')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.flightBooking.update).not.toHaveBeenCalled();
    expect(
      flightIncentivesService.createForTicketedBooking,
    ).not.toHaveBeenCalled();
  });

  it('marks the booking TICKETED and creates the incentive on success', async () => {
    prisma.flightBooking.findUnique.mockResolvedValue(bookingBase);
    provider.issueTicket.mockResolvedValue({
      pnr: 'ABC123',
      status: 'TICKETED',
    });
    prisma.flightBooking.update.mockResolvedValue({
      ...bookingBase,
      status: FlightBookingStatus.TICKETED,
      pnr: 'ABC123',
    });
    prisma.customer.findUnique.mockResolvedValue({
      identity: { email: 'a@example.com', id: 'id-1' },
    });

    const result = await service.issueTicket('booking-1', 'staff-1');

    expect(result.status).toBe(FlightBookingStatus.TICKETED);
    expect(prisma.flightBooking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: FlightBookingStatus.TICKETED,
          pnr: 'ABC123',
        }),
      }),
    );
    expect(flightIncentivesService.createForTicketedBooking).toHaveBeenCalled();
  });
});
