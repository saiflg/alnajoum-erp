import { Test, TestingModule } from '@nestjs/testing';
import { IncentivePolicyType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlightIncentivesService } from './flight-incentives.service';

describe('FlightIncentivesService', () => {
  let service: FlightIncentivesService;
  let prisma: {
    flightPricingRule: { findUnique: jest.Mock };
    incentivePolicy: { findFirst: jest.Mock };
    staffIncentive: { findFirst: jest.Mock; create: jest.Mock };
    staff: { findUnique: jest.Mock };
  };
  let auditService: { record: jest.Mock };
  let notificationsService: { sendIncentiveUpdate: jest.Mock };

  const booking = {
    id: 'booking-1',
    bookingReference: 'ANJ-ABCD1234',
    bookedByStaffId: 'staff-1' as string | null,
    ticketedByStaffId: 'staff-1' as string | null,
    providerCost: 100_000 as number | null,
    totalAmount: 120_000,
    currency: 'NGN',
    customerId: 'customer-1',
    pricingRuleId: null as string | null,
  };
  const call = (b: typeof booking) =>
    service.createForTicketedBooking(
      b as unknown as Parameters<typeof service.createForTicketedBooking>[0],
    );

  beforeEach(async () => {
    prisma = {
      flightPricingRule: { findUnique: jest.fn() },
      incentivePolicy: { findFirst: jest.fn() },
      staffIncentive: { findFirst: jest.fn(), create: jest.fn() },
      staff: { findUnique: jest.fn() },
    };
    auditService = { record: jest.fn() };
    notificationsService = { sendIncentiveUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightIncentivesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();
    service = module.get(FlightIncentivesService);
  });

  it('does nothing when there is no staff to credit', async () => {
    await call({ ...booking, bookedByStaffId: null, ticketedByStaffId: null });
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('does nothing when the booking has no costing snapshot', async () => {
    await call({ ...booking, providerCost: null });
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('is idempotent — skips if an incentive already exists for this booking', async () => {
    prisma.staffIncentive.findFirst.mockResolvedValue({ id: 'existing' });
    await call(booking);
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('creates zero incentive when no policy is configured (conservative default)', async () => {
    prisma.staffIncentive.findFirst.mockResolvedValue(null);
    prisma.incentivePolicy.findFirst.mockResolvedValue(null);
    await call(booking);
    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('creates an incentive off the platform default policy using the shared calculator', async () => {
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

    // margin = 120_000 - 100_000 = 20_000; 50% -> 10_000
    expect(prisma.staffIncentive.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          staffId: 'staff-1',
          sourceType: 'FLIGHT_BOOKING',
          sourceId: 'booking-1',
          amount: 10_000,
          margin: 20_000,
        }),
      }),
    );
    expect(notificationsService.sendIncentiveUpdate).toHaveBeenCalled();
  });

  it('prefers the pricing rule incentive policy over the platform default', async () => {
    prisma.staffIncentive.findFirst.mockResolvedValue(null);
    prisma.flightPricingRule.findUnique.mockResolvedValue({
      incentivePolicy: {
        id: 'route-policy',
        type: IncentivePolicyType.FIXED_AMOUNT,
        config: { amount: 3_000 },
        isActive: true,
      },
    });
    prisma.staffIncentive.create.mockResolvedValue({
      id: 'inc-1',
      referenceNumber: 'INC-1',
      currency: 'NGN',
    });
    prisma.staff.findUnique.mockResolvedValue(null);

    await call({ ...booking, pricingRuleId: 'rule-1' });

    expect(prisma.incentivePolicy.findFirst).not.toHaveBeenCalled();
    expect(prisma.staffIncentive.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 3_000 }),
      }),
    );
  });
});
