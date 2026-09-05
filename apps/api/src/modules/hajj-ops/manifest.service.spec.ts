import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PilgrimType, ReadinessStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ManifestService } from './manifest.service';
import { ReadinessService } from './readiness.service';

describe('ManifestService (spec #17/#18/#20 — group manifest export)', () => {
  let service: ManifestService;
  let prisma: Record<string, any>;
  let readinessService: { compute: jest.Mock };

  const group = {
    groupNumber: 'HGRP-1',
    name: 'Batch A',
    pilgrims: [
      {
        id: 'p1',
        customerId: 'cust-1',
        familyMemberId: null,
        firstName: 'Amina',
        lastName: 'Yusuf',
        passportNumber: 'A001',
        pilgrimCode: 'PLG-1',
      },
      {
        id: 'p2',
        customerId: null,
        familyMemberId: 'fm-1',
        firstName: 'Bilal',
        lastName: 'Yusuf',
        passportNumber: null,
        pilgrimCode: null,
      },
    ],
    roomAllocations: [
      {
        roomNumber: '101',
        occupants: [{ pilgrimId: 'p1' }],
        hotelBooking: null,
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      hajjGroup: { findUnique: jest.fn().mockResolvedValue(group) },
      umrahGroup: { findUnique: jest.fn() },
      flightBookingPassenger: { findFirst: jest.fn().mockResolvedValue(null) },
      hotelBookingGuest: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    readinessService = {
      compute: jest
        .fn()
        .mockResolvedValue({ finalStatus: ReadinessStatus.AMBER }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManifestService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReadinessService, useValue: readinessService },
      ],
    }).compile();

    service = module.get(ManifestService);
  });

  it('404s when the group does not exist', async () => {
    prisma.hajjGroup.findUnique.mockResolvedValue(null);
    await expect(
      service.renderCsv(PilgrimType.HAJJ, 'missing'),
    ).rejects.toThrow(NotFoundException);
  });

  it('includes every pilgrim, their room (or "Unassigned"), and their live readiness in the CSV', async () => {
    const { content, filename } = await service.renderCsv(
      PilgrimType.HAJJ,
      'group-1',
    );

    expect(filename).toBe('manifest-HGRP-1.csv');
    expect(content).toContain(
      'Amina Yusuf,A001,PLG-1,101,Not booked,Not booked,AMBER',
    );
    expect(content).toContain(
      'Bilal Yusuf,—,Not generated,Unassigned,Not booked,Not booked,AMBER',
    );
  });

  it('resolves the flight/hotel booking reference by matching customerId or familyMemberId, same as ReadinessService', async () => {
    prisma.flightBookingPassenger.findFirst.mockResolvedValueOnce({
      booking: { bookingReference: 'FLT-123' },
    });
    prisma.hotelBookingGuest.findFirst.mockResolvedValueOnce({
      booking: { bookingReference: 'HTL-456', hotelName: 'Hilton Makkah' },
    });

    const { content } = await service.renderCsv(PilgrimType.HAJJ, 'group-1');

    expect(prisma.flightBookingPassenger.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'cust-1' } }),
    );
    expect(content).toContain('FLT-123');
    expect(content).toContain('HTL-456 (Hilton Makkah)');
  });

  it("prefers the pilgrim's actual assigned room's linked hotel booking over the generic guest match (deeper hotel-catalog integration)", async () => {
    prisma.hajjGroup.findUnique.mockResolvedValue({
      ...group,
      roomAllocations: [
        {
          roomNumber: '208',
          occupants: [{ pilgrimId: 'p1' }],
          hotelBooking: {
            bookingReference: 'HTL-DEMO0003',
            hotelName: 'Real Grand Hotel',
          },
        },
      ],
    });
    // A different, generic HotelBookingGuest match exists too — the room's
    // own linked booking must win since it's the pilgrim's actual stay.
    prisma.hotelBookingGuest.findFirst.mockResolvedValue({
      booking: {
        bookingReference: 'HTL-UNRELATED',
        hotelName: 'Some Other Hotel',
      },
    });

    const { content } = await service.renderCsv(PilgrimType.HAJJ, 'group-1');
    const aminaRow = content
      .split('\n')
      .find((line) => line.startsWith('Amina Yusuf'));
    const bilalRow = content
      .split('\n')
      .find((line) => line.startsWith('Bilal Yusuf'));

    // p1 (Amina) is in the linked room — its booking wins over her own
    // generic guest match.
    expect(aminaRow).toContain('HTL-DEMO0003 (Real Grand Hotel)');
    // p2 (Bilal) has no room assignment at all, so he correctly falls back
    // to the generic HotelBookingGuest match instead.
    expect(bilalRow).toContain('HTL-UNRELATED (Some Other Hotel)');
  });

  it('never renders a synced readiness field — always calls ReadinessService.compute per pilgrim', async () => {
    await service.renderCsv(PilgrimType.HAJJ, 'group-1');

    expect(readinessService.compute).toHaveBeenCalledWith(
      PilgrimType.HAJJ,
      'p1',
    );
    expect(readinessService.compute).toHaveBeenCalledWith(
      PilgrimType.HAJJ,
      'p2',
    );
  });
});
