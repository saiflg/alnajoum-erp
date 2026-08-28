import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InvoicesService } from './invoices.service';

const baseBooking = {
  id: 'booking-1',
  bookingReference: 'ANJ-ABCD1234',
  customerId: 'customer-1',
  bookedByStaffId: null,
  currency: 'NGN',
  totalAmount: 100_000,
  origin: 'LOS',
  destination: 'ABV',
} as never;

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      invoice: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(InvoicesService);
  });

  describe('createForFlightBooking', () => {
    it('creates an ISSUED invoice with a single line item describing the flight', () => {
      const tx = { invoice: { create: jest.fn() } };

      void service.createForFlightBooking(baseBooking, tx as never);

      expect(tx.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'customer-1',
            flightBookingId: 'booking-1',
            status: InvoiceStatus.ISSUED,
            currency: 'NGN',
            totalAmount: 100_000,
            lineItems: {
              create: [
                expect.objectContaining({
                  description: expect.stringContaining('ANJ-ABCD1234'),
                  amount: 100_000,
                }),
              ],
            },
          }),
        }),
      );
    });
  });

  describe('createForHajjRegistration', () => {
    const registration = {
      id: 'reg-1',
      registrationNumber: 'HAJJ-ABC123',
      customerId: 'customer-1',
      registeredByStaffId: null,
      currency: 'NGN',
      totalAmount: 12_000_000,
      package: { name: 'Standard Hajj 2027' },
    };

    it('creates one line item per pilgrim, each named and evenly amounted', () => {
      const tx = { invoice: { create: jest.fn() } };
      const pilgrims = [
        { firstName: 'Amina', lastName: 'Bello' },
        { firstName: 'Musa', lastName: 'Bello' },
      ] as never;

      void service.createForHajjRegistration(
        registration as never,
        pilgrims,
        tx as never,
      );

      expect(tx.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hajjRegistrationId: 'reg-1',
            totalAmount: 12_000_000,
            lineItems: {
              create: [
                expect.objectContaining({
                  description: expect.stringContaining('Amina Bello'),
                  amount: 6_000_000,
                }),
                expect.objectContaining({
                  description: expect.stringContaining('Musa Bello'),
                  amount: 6_000_000,
                }),
              ],
            },
          }),
        }),
      );
    });

    it('rounds the remainder into the last pilgrim so shares always sum to the total exactly', () => {
      const tx = { invoice: { create: jest.fn() } };
      const pilgrims = [
        { firstName: 'A', lastName: 'One' },
        { firstName: 'B', lastName: 'Two' },
        { firstName: 'C', lastName: 'Three' },
      ] as never;

      void service.createForHajjRegistration(
        { ...registration, totalAmount: 10_000_000 } as never,
        pilgrims,
        tx as never,
      );

      const created = tx.invoice.create.mock.calls[0][0].data.lineItems.create;
      const amounts = created.map((item: { amount: number }) => item.amount);
      expect(amounts).toEqual([3_333_333, 3_333_333, 3_333_334]);
      expect(amounts.reduce((a: number, b: number) => a + b, 0)).toBe(10_000_000);
    });
  });

  describe('getInvoice', () => {
    it('throws NotFound when the invoice does not exist', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(service.getInvoice('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the invoice belongs to a different customer', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        customerId: 'customer-a',
      });

      await expect(
        service.getInvoice('invoice-1', 'customer-b'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('recomputeStatus', () => {
    it('sets ISSUED when nothing has been paid', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        status: InvoiceStatus.ISSUED,
        totalAmount: 100_000,
        payments: [],
      });
      prisma.invoice.update.mockResolvedValue({});

      await service.recomputeStatus('invoice-1');

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: InvoiceStatus.ISSUED } }),
      );
    });

    it('sets PARTIALLY_PAID when some but not all has been paid', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        status: InvoiceStatus.ISSUED,
        totalAmount: 100_000,
        payments: [{ amount: 40_000 }],
      });
      prisma.invoice.update.mockResolvedValue({});

      await service.recomputeStatus('invoice-1');

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: InvoiceStatus.PARTIALLY_PAID },
        }),
      );
    });

    it('sets PAID once payments cover the full total', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        status: InvoiceStatus.PARTIALLY_PAID,
        totalAmount: 100_000,
        payments: [{ amount: 40_000 }, { amount: 60_000 }],
      });
      prisma.invoice.update.mockResolvedValue({});

      await service.recomputeStatus('invoice-1');

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: InvoiceStatus.PAID } }),
      );
    });

    it('never recomputes a VOID invoice', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        status: InvoiceStatus.VOID,
        totalAmount: 100_000,
        payments: [],
      });

      const result = await service.recomputeStatus('invoice-1');

      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(result.status).toBe(InvoiceStatus.VOID);
    });
  });

  describe('voidIfUnpaid', () => {
    it('voids an invoice with no payments recorded', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        payments: [],
      });
      prisma.invoice.update.mockResolvedValue({});

      await service.voidIfUnpaid('booking-1');

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { status: InvoiceStatus.VOID },
      });
    });

    it('does not void an invoice that already has payments', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        payments: [{ amount: 10_000 }],
      });

      await service.voidIfUnpaid('booking-1');

      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('does nothing when the booking has no invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await service.voidIfUnpaid('booking-1');

      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });
  });
});
