import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IncentivesService } from './incentives.service';

describe('IncentivesService', () => {
  let service: IncentivesService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      invoice: { findUnique: jest.fn() },
      staffIncentive: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [IncentivesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(IncentivesService);
  });

  it('does nothing when the invoice is not tied to an Umrah registration', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      currency: 'NGN',
      umrahRegistration: null,
    });

    await service.applyForInvoicePayment('invoice-1', 20_000);

    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('does nothing when the registration has no registering staff member', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      currency: 'NGN',
      umrahRegistration: {
        id: 'reg-1',
        registeredByStaffId: null,
        registrationNumber: 'UMRAH-ABC123',
        package: { incentiveRule: { percent: 2 } },
      },
    });

    await service.applyForInvoicePayment('invoice-1', 20_000);

    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('does nothing when the package has no incentive rule', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      currency: 'NGN',
      umrahRegistration: {
        id: 'reg-1',
        registeredByStaffId: 'staff-1',
        registrationNumber: 'UMRAH-ABC123',
        package: { incentiveRule: null },
      },
    });

    await service.applyForInvoicePayment('invoice-1', 20_000);

    expect(prisma.staffIncentive.create).not.toHaveBeenCalled();
  });

  it('computes the incentive as a rounded percentage of the payment amount', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      currency: 'NGN',
      umrahRegistration: {
        id: 'reg-1',
        registeredByStaffId: 'staff-1',
        registrationNumber: 'UMRAH-ABC123',
        package: { incentiveRule: { percent: 2.5 } },
      },
    });

    await service.applyForInvoicePayment('invoice-1', 33_333);

    expect(prisma.staffIncentive.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          staffId: 'staff-1',
          sourceType: 'UMRAH_REGISTRATION',
          sourceId: 'reg-1',
          amount: 833, // round(33,333 * 2.5 / 100) = round(833.325)
          currency: 'NGN',
        }),
      }),
    );
  });

  it('never throws even if the database call fails', async () => {
    prisma.invoice.findUnique.mockRejectedValue(new Error('db down'));

    await expect(
      service.applyForInvoicePayment('invoice-1', 10_000),
    ).resolves.toBeUndefined();
  });
});
