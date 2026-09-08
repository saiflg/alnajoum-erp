import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Customer360Service } from './customer-360.service';

describe('Customer360Service', () => {
  let service: Customer360Service;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn(), findMany: jest.fn() },
      customerTimelineEvent: { findMany: jest.fn(), create: jest.fn() },
      customerNote: { findMany: jest.fn(), create: jest.fn() },
      customerTagAssignment: { upsert: jest.fn(), deleteMany: jest.fn() },
      invoice: { findMany: jest.fn() },
      wallet: { findUnique: jest.fn() },
      walletTransaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      flightBooking: { findMany: jest.fn(), count: jest.fn() },
      hotelBooking: { findMany: jest.fn(), count: jest.fn() },
      visaApplication: { findMany: jest.fn(), count: jest.fn() },
      hajjRegistration: { findMany: jest.fn(), count: jest.fn() },
      umrahRegistration: { findMany: jest.fn(), count: jest.fn() },
      travelPackage: { findMany: jest.fn() },
      supportTicket: { findMany: jest.fn() },
      complaint: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Customer360Service,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(Customer360Service);
  });

  /**
   * Phase 11 spec #3/#65 — the mandatory cross-tenant test for this
   * service specifically: it aggregates identity, wallet, invoices, and
   * bookings across every module in one call, so a leak here is the
   * single most damaging version of the bug this sweep is fixing.
   */
  describe('getProfile', () => {
    it('throws NotFound for a customer belonging to a different tenant', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        companyId: 'company-b',
      });

      await expect(
        service.getProfile('customer-1', 'company-a'),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns the profile when it belongs to the caller's own tenant", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        companyId: 'company-a',
      });

      await expect(
        service.getProfile('customer-1', 'company-a'),
      ).resolves.toEqual(expect.objectContaining({ id: 'customer-1' }));
    });

    it('applies no tenant check when none is given (SUPER_ADMIN)', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        companyId: 'company-b',
      });

      await expect(service.getProfile('customer-1')).resolves.toEqual(
        expect.objectContaining({ id: 'customer-1' }),
      );
    });
  });

  /**
   * Every other aggregate method (getBookings/getFinancials/timeline/
   * segments/notes/tags) delegates to the same assertCustomerInTenant
   * guard as getProfile — this exercises that guard once through a
   * representative method rather than duplicating the same three cases
   * eight more times.
   */
  describe('getFinancials — representative of every guarded aggregate method', () => {
    it('throws NotFound before touching invoices/wallet for a cross-tenant customer', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        companyId: 'company-b',
      });

      await expect(
        service.getFinancials('customer-1', 'company-a'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });

    it("proceeds when the customer belongs to the caller's own tenant", async () => {
      prisma.customer.findUnique.mockResolvedValue({ companyId: 'company-a' });
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.wallet.findUnique.mockResolvedValue(null);

      await service.getFinancials('customer-1', 'company-a');

      expect(prisma.invoice.findMany).toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('scopes the customer branch by companyId when a tenant filter is given', async () => {
      for (const key of [
        'customer',
        'flightBooking',
        'hotelBooking',
        'visaApplication',
        'supportTicket',
      ]) {
        prisma[key].findMany.mockResolvedValue([]);
      }

      await service.search('okafor', 'company-a');

      const customerCall = prisma.customer.findMany.mock.calls[0][0];
      expect(customerCall.where.companyId).toBe('company-a');
      const flightCall = prisma.flightBooking.findMany.mock.calls[0][0];
      expect(flightCall.where.customer).toEqual({ companyId: 'company-a' });
    });

    it('applies no tenant filter when none is given (SUPER_ADMIN)', async () => {
      for (const key of [
        'customer',
        'flightBooking',
        'hotelBooking',
        'visaApplication',
        'supportTicket',
      ]) {
        prisma[key].findMany.mockResolvedValue([]);
      }

      await service.search('okafor');

      const customerCall = prisma.customer.findMany.mock.calls[0][0];
      expect(customerCall.where).not.toHaveProperty('companyId');
    });
  });
});
