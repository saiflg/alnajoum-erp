import { Test, TestingModule } from '@nestjs/testing';
import { IncentivePolicyType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HotelIncentivesService } from './hotel-incentives.service';

describe('HotelIncentivesService', () => {
  let service: HotelIncentivesService;
  let prisma: {
    incentivePolicy: { findFirst: jest.Mock };
    staffIncentive: { findFirst: jest.Mock; create: jest.Mock };
    staff: { findUnique: jest.Mock };
  };

  const booking = {
    id: 'booking-1',
    bookingReference: 'HTL-ABCD1234',
    bookedByStaffId: 'staff-1' as string | null,
    completedByStaffId: 'staff-1' as string | null,
    supplierCost: 300_000 as number | null,
    totalAmount: 400_000,
    currency: 'NGN',
    customerId: 'customer-1',
  };
  const call = (b: typeof booking) =>
    service.createForCompletedBooking(
      b as unknown as Parameters<typeof service.createForCompletedBooking>[0],
    );

  beforeEach(async () => {
    prisma = {
      incentivePolicy: { findFirst: jest.fn() },
      staffIncentive: { findFirst: jest.fn(), create: jest.fn() },
      staff: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotelIncentivesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { sendIncentiveUpdate: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(HotelIncentivesService);
  });

  it('does nothing when there is no staff to credit', async () => {
    await call({ ...booking, bookedByStaffId: null, completedByStaffId: null });
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('does nothing when there is no supplier cost snapshot (e.g. a MOCK-provider booking)', async () => {
    await call({ ...booking, supplierCost: null });
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('is idempotent — skips if an incentive already exists for this booking', async () => {
    prisma.staffIncentive.findFirst.mockResolvedValue({ id: 'existing' });
    await call(booking);
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('creates an incentive using the shared calculator off the platform default policy', async () => {
    prisma.staffIncentive.findFirst.mockResolvedValue(null);
    prisma.incentivePolicy.findFirst.mockResolvedValue({
      id: 'policy-1',
      type: IncentivePolicyType.PERCENT_OF_MARGIN,
      config: { percent: 50 },
      isActive: true,
    });
    prisma.staffIncentive.create.mockResolvedValue({
      id: 'inc-1',
      referenceNumber: 'INC-1',
      currency: 'NGN',
    });
    prisma.staff.findUnique.mockResolvedValue({
      identity: { id: 'identity-1', email: 'staff@example.com' },
    });

    await call(booking);

    // margin = 400_000 - 300_000 = 100_000; 50% -> 50_000
    expect(prisma.staffIncentive.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'HOTEL_BOOKING',
          sourceId: 'booking-1',
          amount: 50_000,
          margin: 100_000,
        }),
      }),
    );
  });
});
