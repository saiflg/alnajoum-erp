import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightAncillaryStatus, FlightAncillaryType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FlightAncillariesService } from './flight-ancillaries.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';

describe('FlightAncillariesService', () => {
  let service: FlightAncillariesService;
  let prisma: {
    flightBooking: { findUnique: jest.Mock };
    flightAncillary: { create: jest.Mock; findMany: jest.Mock };
  };
  let provider: { capabilities: jest.Mock; purchaseAncillary: jest.Mock };
  let auditService: { record: jest.Mock };

  const booking = {
    id: 'booking-1',
    providerOrderId: 'ord_1',
    currency: 'NGN',
  };

  beforeEach(async () => {
    prisma = {
      flightBooking: { findUnique: jest.fn().mockResolvedValue(booking) },
      flightAncillary: { create: jest.fn(), findMany: jest.fn() },
    };
    provider = {
      capabilities: jest.fn().mockResolvedValue({ ancillary: true }),
      purchaseAncillary: jest.fn(),
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightAncillariesService,
        { provide: PrismaService, useValue: prisma },
        { provide: FLIGHT_PROVIDER, useValue: provider },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(FlightAncillariesService);
  });

  it('throws NotFound for a missing booking', async () => {
    prisma.flightBooking.findUnique.mockResolvedValue(null);

    await expect(
      service.purchase('missing', {
        type: FlightAncillaryType.BAGGAGE,
        description: 'Extra bag',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('records a manual-required ancillary when the provider does not support it', async () => {
    provider.capabilities.mockResolvedValue({ ancillary: false });
    prisma.flightAncillary.create.mockResolvedValue({ id: 'anc-1' });

    await service.purchase('booking-1', {
      type: FlightAncillaryType.SEAT,
      description: 'Aisle seat',
    });

    expect(prisma.flightAncillary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: FlightAncillaryStatus.REQUESTED,
        amount: 0,
      }),
    });
    expect(provider.purchaseAncillary).not.toHaveBeenCalled();
  });

  it('records the provider-quoted amount on a confirmed purchase', async () => {
    provider.purchaseAncillary.mockResolvedValue({
      status: 'CONFIRMED',
      amount: 15_000,
      currency: 'NGN',
      providerReference: 'MOCKANC-1',
    });
    prisma.flightAncillary.create.mockResolvedValue({ id: 'anc-1' });

    await service.purchase(
      'booking-1',
      { type: FlightAncillaryType.BAGGAGE, description: 'Extra 23kg bag' },
      'staff-1',
    );

    expect(prisma.flightAncillary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 15_000,
        status: FlightAncillaryStatus.CONFIRMED,
        purchasedByStaffId: 'staff-1',
        providerReference: 'MOCKANC-1',
      }),
    });
  });

  it('records a FAILED ancillary when the provider declines', async () => {
    provider.purchaseAncillary.mockResolvedValue({
      status: 'FAILED',
      amount: 0,
      currency: 'NGN',
      errorMessage: 'No seats available',
    });
    prisma.flightAncillary.create.mockResolvedValue({ id: 'anc-1' });

    await service.purchase('booking-1', {
      type: FlightAncillaryType.SEAT,
      description: 'Window seat',
    });

    expect(prisma.flightAncillary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: FlightAncillaryStatus.FAILED }),
    });
  });
});
